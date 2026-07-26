import { supabase } from './supabaseClient';

// Matches the actual SH2.0 tables: universities, materials, ratings,
// and the materials_with_stats view (flattened, security_invoker = true).

export interface University {
  id: string;
  name: string;
  slug: string;
}

export interface Material {
  id: string;
  uploader_id: string | null;
  university_id: string;
  university_name?: string; // only present when read from materials_with_stats
  course_code: string;
  title: string;
  description: string | null;
  content_snippet: string | null;
  material_type: 'lecture' | 'exam' | 'guide';
  file_path: string;
  file_name: string;
  author_display_name: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  downloads_count: number;
  created_at: string;
  avg_rating?: number;   // only present when read from materials_with_stats
  ratings_count?: number; // only present when read from materials_with_stats
}

export interface Rating {
  id: string;
  material_id: string;
  user_id: string;
  stars: number;
  created_at: string;
}

/* ====================================================================
   1. Universities (there's no departments/courses table in this schema
      -- browsing is by university + a plain course_code text field)
   ==================================================================== */

export async function getUniversities(): Promise<University[]> {
  const { data, error } = await supabase
    .from('universities')
    .select('*')
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
}

/* ====================================================================
   2. Materials
   ==================================================================== */

// Public/approved catalog. Reads the flattened view so university name +
// avg rating come along for free -- no relationship embedding needed.
export async function getApprovedMaterials(filters?: {
  universityId?: string;
  courseCode?: string;
}): Promise<Material[]> {
  let query = supabase
    .from('materials_with_stats')
    .select('*')
    .eq('status', 'approved')
    .order('created_at', { ascending: false });

  if (filters?.universityId) query = query.eq('university_id', filters.universityId);
  if (filters?.courseCode) query = query.eq('course_code', filters.courseCode);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// The signed-in user's own uploads (any status) -- "My Uploads" page.
export async function getMyMaterials(userId: string): Promise<Material[]> {
  const { data, error } = await supabase
    .from('materials')
    .select('*')
    .eq('uploader_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// Moderation queue. RLS already restricts this to moderators/admins --
// a student calling this just gets an empty result, not an error.
export async function getModerationQueue(): Promise<Material[]> {
  const { data, error } = await supabase
    .from('materials')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Upload to the private bucket. Path is {user_id}/{timestamp}-{filename},
// matching the storage RLS policy (own-folder writes only).
export async function uploadMaterialFile(file: File, userId: string): Promise<string> {
  const path = `${userId}/${Date.now()}-${file.name}`;
  const { error } = await supabase.storage.from('materials').upload(path, file);
  if (error) throw error;
  return path; // this is what gets stored in materials.file_path
}

// Private bucket -- signed URL only, never getPublicUrl().
export async function getSignedDownloadUrl(filePath: string, expiresIn = 60): Promise<string> {
  const decoded = decodeURIComponent(filePath); // encoded spaces caused 400s before
  const { data, error } = await supabase.storage
    .from('materials')
    .createSignedUrl(decoded, expiresIn);

  if (error) throw error;
  return data.signedUrl;
}

// Bumps downloads_count via the SECURITY DEFINER RPC -- students don't
// have direct UPDATE rights on materials they didn't upload.
export async function recordDownload(materialId: string): Promise<void> {
  const { error } = await supabase.rpc('increment_downloads', { p_material_id: materialId });
  if (error) throw error;
}

// Insert always lands as status='pending' -- the moderation trigger and
// XP-on-approval logic take it from there.
export async function createMaterial(materialData: {
  universityId: string;
  courseCode: string;
  title: string;
  description?: string;
  contentSnippet?: string;
  materialType: 'lecture' | 'exam' | 'guide';
  filePath: string;
  fileName: string;
  uploaderId: string;
  authorDisplayName?: string; // leave blank to let the DB trigger snapshot it
}): Promise<Material> {
  const { data, error } = await supabase
    .from('materials')
    .insert([{
      university_id: materialData.universityId,
      course_code: materialData.courseCode,
      title: materialData.title,
      description: materialData.description ?? null,
      content_snippet: materialData.contentSnippet ?? null,
      material_type: materialData.materialType,
      file_path: materialData.filePath,
      file_name: materialData.fileName,
      uploader_id: materialData.uploaderId,
      author_display_name: materialData.authorDisplayName ?? null,
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Moderator approve/reject.
export async function moderateMaterial(
  materialId: string,
  moderatorId: string,
  decision: 'approved' | 'rejected',
  rejectionReason?: string
): Promise<Material> {
  const { data, error } = await supabase
    .from('materials')
    .update({
      status: decision,
      reviewed_by: moderatorId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: decision === 'rejected' ? (rejectionReason ?? null) : null,
    })
    .eq('id', materialId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/* ====================================================================
   3. Ratings
   ==================================================================== */

// Upsert -- one rating per user per material, enforced by the DB's
// unique(material_id, user_id) constraint.
export async function submitRating(materialId: string, userId: string, stars: number): Promise<Rating> {
  const { data, error } = await supabase
    .from('ratings')
    .upsert(
      { material_id: materialId, user_id: userId, stars },
      { onConflict: 'material_id,user_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}