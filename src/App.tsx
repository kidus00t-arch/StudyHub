import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Moon,
  Sun,
  Download,
  FileText,
  CheckCircle,
  X,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  GraduationCap,
  Clock,
  Plus,
  BookOpen,
  HelpCircle,
  Sparkles,
  User,
  LogOut,
  ArrowUpFromLine,
  ThumbsUp,
  Award,
  BookMarked,
  Eye,
  EyeOff,
  Star
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import {
  University,
  Material,
  getUniversities,
  getApprovedMaterials,
  getModerationQueue,
  moderateMaterial,
  uploadMaterialFile,
  createMaterial,
  getSignedDownloadUrl,
  recordDownload,
  submitRating,
} from './studyhubService';
import { button } from 'motion/react-m';

// "2h ago" / "3d ago" style relative time from a created_at timestamp.
function timeAgo(dateString: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export default function App() {
  // Theme state: defaults to dark mode (true) to show off the midnight indigo aesthetic first
  const [darkMode, setDarkMode] = useState<boolean>(true);

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [universities, setUniversities] = useState<University[]>([]);
  const [selectedUniversity, setSelectedUniversity] = useState<string>(''); // '' = All Universities
  const [notes, setNotes] = useState<Material[]>([]);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all');

  // Carousel pagination state (3 cards per page)
  const [currentPage, setCurrentPage] = useState<number>(0);

  const [isViewOpen, setIsViewOpen] = useState<boolean>(false);

  // Download modal states
  const [downloadingNote, setDownloadingNote] = useState<Material | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'progress' | 'completed'>('idle');

  // Upload modal states
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [newNote, setNewNote] = useState({
    course: '',
    type: 'lecture' as 'lecture' | 'exam' | 'guide',
    title: '',
    description: '',
    universityId: '',
    author: '',
    contentSnippet: ''
  });

  // Real Supabase Auth
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<{ full_name: string | null; points: number; role: string } | null>(null);
  const [isLoginOpen, setIsLoginOpen] = useState<boolean>(false);
  const [isSignupOpen, setIsSignupOpen] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [authForm, setAuthForm] = useState({ email: '', password: '', name: '' });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const currentUser = session && profile
    ? { name: profile.full_name || session.user.email!.split('@')[0], email: session.user.email!, points: profile.points }
    : null;
  const isPrivileged = profile?.role === 'moderator' || profile?.role === 'admin';

  const [isModerateOpen, setIsModerateOpen] = useState<boolean>(false);
  const [moderationQueue, setModerationQueue] = useState<Material[]>([]);
  const [moderationLoading, setModerationLoading] = useState<boolean>(false);

  // Auth session bootstrap + live listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Load the signed-in user's profile row (name, XP) whenever the session changes
  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    supabase
      .from('profiles')
      .select('full_name, points, role')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data));
  }, [session]);

  // Load universities once
  useEffect(() => {
    getUniversities().then(setUniversities).catch(() => triggerToast('Could not load universities.'));
  }, []);

  // Load approved materials whenever the university filter changes
  useEffect(() => {
    getApprovedMaterials(selectedUniversity ? { universityId: selectedUniversity } : undefined)
      .then(setNotes)
      .catch(() => triggerToast('Could not load study materials.'));
  }, [selectedUniversity]);

  // Sync dark mode class with root html element
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleRateNote = async (noteId: string, ratingValue: number) => {
    if (!session) {
      triggerToast('Sign in to rate this document.');
      return;
    }
    try {
      await submitRating(noteId, session.user.id, ratingValue);
      const refreshed = await getApprovedMaterials(selectedUniversity ? { universityId: selectedUniversity } : undefined);
      setNotes(refreshed);
      setDownloadingNote(prev => (prev ? refreshed.find(n => n.id === prev.id) || prev : prev));
      triggerToast(`Thank you! You rated this note ${ratingValue} stars.`);
    } catch {
      triggerToast('Could not submit rating. Please try again.');
    }
  };

  const openModerateModal = async () => {
    setIsModerateOpen(true);
    setModerationLoading(true);
    try {
      setModerationQueue(await getModerationQueue());
    } catch {
      triggerToast('Could not load the moderation queue.');
    } finally {
      setModerationLoading(false);
    }
  };

  const handleModerate = async (material: Material, decision: 'approved' | 'rejected') => {
    if (!session) return;
    let rejectionReason: string | undefined;
    if (decision === 'rejected') {
      rejectionReason = window.prompt('Reason for rejecting this upload (shown to the student):') || undefined;
    }
    try {
      await moderateMaterial(material.id, session.user.id, decision, rejectionReason);
      setModerationQueue(prev => prev.filter(m => m.id !== material.id));
      triggerToast(`"${material.title}" ${decision}.`);
      if (decision === 'approved') {
        getApprovedMaterials(selectedUniversity ? { universityId: selectedUniversity } : undefined).then(setNotes);
      }
    } catch {
      triggerToast('Could not update this material. Please try again.');
    }
  };

  const previewModeratedFile = async (material: Material) => {
    try {
      const url = await getSignedDownloadUrl(material.file_path);
      window.open(url, '_blank');
    } catch {
      triggerToast('Could not open the file.');
    }
  };

  // Filter and Search logic (university filtering happens server-side, see effect above)
  const filteredNotes = useMemo(() => {
    return notes.filter(note => {
      const matchesType = selectedTypeFilter === 'all' || note.material_type === selectedTypeFilter;

      const cleanQuery = searchQuery.toLowerCase().trim();
      const matchesText = cleanQuery === '' ||
        note.course_code.toLowerCase().includes(cleanQuery) ||
        note.title.toLowerCase().includes(cleanQuery) ||
        (note.description || '').toLowerCase().includes(cleanQuery) ||
        (note.university_name || '').toLowerCase().includes(cleanQuery) ||
        (note.author_display_name || '').toLowerCase().includes(cleanQuery);

      return matchesType && matchesText;
    });
  }, [notes, selectedTypeFilter, searchQuery]);

  // Pagination bounds based on filtered items
  const cardsPerPage = 3;
  const totalPages = Math.max(1, Math.ceil(filteredNotes.length / cardsPerPage));

  useEffect(() => {
    if (currentPage >= totalPages) {
      setCurrentPage(0);
    }
  }, [filteredNotes, totalPages, currentPage]);

  const displayedNotes = useMemo(() => {
    const startIdx = currentPage * cardsPerPage;
    return filteredNotes.slice(startIdx, startIdx + cardsPerPage);
  }, [filteredNotes, currentPage]);

  const handleNextPage = () => setCurrentPage((prev) => (prev + 1) % totalPages);
  const handlePrevPage = () => setCurrentPage((prev) => (prev - 1 + totalPages) % totalPages);

  // Real signed-URL download + server-side download counter (bucket is private)
  const startDownload = async (note: Material) => {
    setDownloadStatus('progress');
    setDownloadProgress(0);

    const interval = setInterval(() => {
      setDownloadProgress((prev) => (prev >= 90 ? prev : prev + 10));
    }, 150);

    try {
      const url = await getSignedDownloadUrl(note.file_path);
      await recordDownload(note.id);
      clearInterval(interval);
      setDownloadProgress(100);
      setDownloadStatus('completed');
      setNotes(prev => prev.map(n => (n.id === note.id ? { ...n, downloads_count: n.downloads_count + 1 } : n)));
      setDownloadingNote(prev => (prev && prev.id === note.id ? { ...prev, downloads_count: prev.downloads_count + 1 } : prev));
      window.open(url, '_blank');
      triggerToast(`Successfully downloaded "${note.title}" for ${note.course_code}!`);
    } catch {
      clearInterval(interval);
      setDownloadStatus('idle');
      triggerToast('Download failed. Please try again.');
    }
  };

  // Real upload: file -> private bucket, row -> materials (lands as status='pending')
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !session) {
      triggerToast('Sign in to upload study materials.');
      return;
    }
    if (!newNote.course || !newNote.title || !newNote.description || !newNote.universityId || !uploadFile) {
      triggerToast('Please fill in all required fields and attach a file.');
      return;
    }

    try {
      const filePath = await uploadMaterialFile(uploadFile, session.user.id);
      await createMaterial({
        universityId: newNote.universityId,
        courseCode: newNote.course.toUpperCase(),
        title: newNote.title,
        description: newNote.description,
        contentSnippet: newNote.contentSnippet || undefined,
        materialType: newNote.type,
        filePath,
        fileName: uploadFile.name,
        uploaderId: session.user.id,
        authorDisplayName: newNote.author || undefined,
      });

      setIsUploadOpen(false);
      triggerToast(`"${newNote.title}" submitted for review! You'll get +50 XP once a moderator approves it.`);

      setNewNote({ course: '', type: 'lecture', title: '', description: '', universityId: '', author: '', contentSnippet: '' });
      setUploadFile(null);
    } catch {
      triggerToast('Upload failed. Please try again.');
    }
  };

  const openUploadModal = () => {
    if (!currentUser) {
      triggerToast('Sign in first to contribute study materials.');
      setIsSignupOpen(true);
      return;
    }
    setIsUploadOpen(true);
  };

  // Real auth
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email: authForm.email, password: authForm.password });
    if (error) {
      triggerToast(error.message);
      return;
    }
    setIsLoginOpen(false);
    triggerToast('Welcome back!');
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signUp({
      email: authForm.email,
      password: authForm.password,
      options: { data: { full_name: authForm.name } },
    });
    if (error) {
      triggerToast(error.message);
      return;
    }
    setIsSignupOpen(false);
    triggerToast('Account created! You received a 200 XP welcome bonus.');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    triggerToast('Logged out successfully.');
  };

  return (
    <div className="min-h-screen bg-[var(--bg-deep)] text-[var(--text-body)] font-sans transition-colors duration-300 relative selection:bg-[var(--marigold)] selection:text-[#06141B] flex flex-col justify-between">

      {/* Toast Alert popup */}
      {toastMessage && (
        <div id="toast" className="fixed top-20 right-6 z-50 bg-[var(--bg-surface)] border-2 border-[var(--marigold)] text-[var(--text-title)] px-6 py-4 rounded-lg shadow-2xl flex items-center gap-3 animate-bounce">
          <Sparkles className="text-[var(--marigold)] animate-spin" size={20} />
          <span className="font-medium text-sm">{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="ml-2 hover:text-[var(--marigold)]">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Primary Navigation Bar */}
      <nav id="navbar" className="sticky top-0 z-40 bg-[var(--bg-deep)] border-b border-[var(--border-color)]/30 backdrop-blur-md">
        <div className="max-w-[1152px] mx-auto px-4 md:px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-8">
            <span id="logo" className="font-serif text-2xl font-bold text-[var(--text-title)] tracking-tight">
              StudyHub
            </span>
            <div className="hidden md:flex gap-6">
              <button
                onClick={() => {
                  setSelectedUniversity('');
                  setSelectedTypeFilter('all');
                  setSearchQuery('');
                }}
                className="text-[var(--marigold)] font-bold border-b-2 border-[var(--marigold)] pb-1 text-sm hover:opacity-90 transition-opacity"
                id="nav-browse"
              >
                Browse
              </button>
              {isPrivileged && (
                <button
                  onClick={openModerateModal}
                  className="text-[var(--text-muted)] hover:text-[var(--marigold)] font-bold text-sm transition-colors flex items-center gap-1.5"
                  id="nav-moderate"
                >
                  <GraduationCap size={16} />
                  <span>Moderate</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 md:gap-4">
            <button
              id="theme-toggle"
              aria-label="Toggle theme"
              onClick={() => setDarkMode(!darkMode)}
              className="text-[var(--text-muted)] hover:text-[var(--marigold)] transition-colors duration-200 flex items-center justify-center p-2 rounded-full hover:bg-[var(--bg-surface)]"
            >
              {darkMode ? <Sun size={20} className="text-[var(--marigold)]" /> : <Moon size={20} className="text-[#14213D]" />}
            </button>

            {currentUser ? (
              <div className="flex items-center gap-2 md:gap-4">
                <div className="bg-[var(--bg-surface)] px-3 py-1.5 rounded-md border border-[var(--border-color)] text-xs font-mono hidden sm:flex items-center gap-1.5">
                  <Award size={14} className="text-[var(--marigold)]" />
                  <span>{currentUser.points} XP</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-[var(--marigold)] text-[#06141B] font-bold flex items-center justify-center text-sm shadow">
                    {currentUser.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm font-medium hidden md:inline text-[var(--text-title)]">{currentUser.name}</span>
                </div>
                <button onClick={handleLogout} title="Sign out" className="text-[var(--text-muted)] hover:text-red-500 p-1.5 rounded">
                  <LogOut size={18} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 md:gap-3">
                <button
                  onClick={() => { setAuthForm({ email: '', password: '', name: '' }); setIsLoginOpen(true); }}
                  className="text-[var(--text-muted)] hover:text-[var(--marigold)] font-semibold text-sm px-3 py-2 transition-colors duration-200"
                >
                  Log in
                </button>
                <button
                  onClick={() => { setAuthForm({ email: '', password: '', name: '' }); setIsSignupOpen(true); }}
                  className="bg-[var(--marigold)] text-[#06141B] px-5 py-2 rounded font-bold text-sm hover:bg-[var(--marigold-dark)] transition-all transform active:scale-95 shadow-md"
                >
                  Sign up
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Header Area */}
      <header id="hero" className="relative overflow-hidden pt-12 pb-16 px-4 md:px-6 max-w-[1152px] mx-auto w-full desk-lamp-effect">
        <div className="absolute inset-0 z-0 pointer-events-none opacity-40">
          <div className="absolute w-[800px] h-[800px] -top-96 -left-96 bg-[var(--bg-surface)] rounded-full blur-[120px]"></div>
          <div className="absolute w-[600px] h-[600px] -bottom-48 -right-48 bg-[var(--bg-surface)] rounded-full blur-[100px]"></div>
        </div>

        <div className="relative z-10 grid md:grid-cols-12 gap-10 items-center">
          <div className="md:col-span-7 space-y-6">
            <h1 className="font-serif text-4xl md:text-5xl lg:text-[48px] lg:leading-[56px] text-[var(--text-title)] font-bold tracking-tight">
              Find your course.<br />
              Get the notes.<br />
              Skip the scramble.
            </h1>
            <p className="text-base md:text-lg text-[var(--text-muted)] max-w-lg leading-relaxed">
              Lecture notes, past exams, and solved exercises — uploaded by the students who sat through the same lecture you just did.
            </p>

            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-3 search-glow rounded-lg transition-shadow duration-300">
                <div className="relative flex-grow">
                  <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-[var(--bg-deep)] border border-[var(--border-color)] rounded-lg px-12 py-4 focus:outline-none focus:border-[var(--marigold)] text-[var(--text-body)] placeholder-[var(--text-muted)]/80 text-sm md:text-base transition-colors"
                    placeholder="Search courses, titles, or concepts (e.g., Calculus, CS101)..."
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-title)]">
                      <X size={18} />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (searchQuery.trim()) {
                      triggerToast(`Searched for "${searchQuery}" - found ${filteredNotes.length} matching documents!`);
                    } else {
                      triggerToast('Please type a search query first.');
                    }
                  }}
                  className="bg-[var(--marigold)] text-[#06141B] px-8 py-4 rounded-lg font-bold text-sm md:text-base hover:bg-[var(--marigold-dark)] transition-all shadow-lg active:scale-95 whitespace-nowrap"
                >
                  Search
                </button>
              </div>

              {searchQuery && (
                <div className="flex items-center justify-between text-xs font-mono text-[var(--text-muted)] px-1">
                  <span>Found {filteredNotes.length} matching item(s)</span>
                  <button onClick={() => setSearchQuery('')} className="underline text-[var(--marigold)]">clear search</button>
                </div>
              )}
            </div>

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-[var(--text-muted)]">Have your own study materials?</span>
              <button
                onClick={openUploadModal}
                className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border border-[var(--marigold)] text-[var(--marigold)] hover:bg-[var(--marigold)] hover:text-[#06141B] transition-all"
              >
                <ArrowUpFromLine size={12} />
                <span>Upload & Earn XP</span>
              </button>
            </div>
          </div>

          <div className="md:col-span-5 hidden md:flex justify-end items-center relative h-full">
            <div className={`group relative w-full max-w-[360px] h-[340px] rounded-xl overflow-hidden border border-[var(--border-color)] bg-[var(--bg-surface)] shadow-2xl transition-all duration-500 ${darkMode ? 'rotate-2 hover:rotate-0' : 'rotate-0 hover:rotate-1'}`}>
              <img
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuCNjWIb-ZRawi2Qv4V70t27XcwEvK_1sdhtJNleI04xTC_CkyXw19MNyD833I_VULE_sXH-yl33ShTnakDtBnHrott6PlDUfuQHn2qyvIN-swqDSNihH0wn2Febn3T1GpBPRiYSZL7F0TXgNaT_LCS4mocs7yJJNVGaRpRwGvCqcHFDviS0xmrkpMghwVsf6K8SnYxP6PQ3DLhoHvb8p3ye0EEBe9C-381e09ZCnIKtm_6DJB_AcLTSDVrRaw-5D0AySC2x3XMHKQeP-Q"
                alt="High-quality library books archive"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover opacity-60 dark:opacity-50 transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-deep)]/90 via-transparent to-transparent"></div>
              <div className="absolute bottom-6 left-6 right-6">
                <div className="stamp mb-4">
                  <span className="text-[var(--marigold)]">ARCHIVE_01</span>
                </div>
                <h3 className="font-serif text-xl font-bold text-[var(--text-title)]">Main Archive</h3>
                <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">Plenty Documents • Plenty Reviews</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Browse by School/University Section */}
      <section id="browse-universities" className="max-w-[1152px] mx-auto w-full py-8 px-4 md:px-6 border-t border-[var(--border-color)]/20">
        <div className="flex justify-between items-end mb-6">
          <div className="space-y-1">
            <h2 className="font-serif text-xl md:text-2xl text-[var(--text-title)] font-bold">Browse by University</h2>
            <p className="text-xs text-[var(--text-muted)]">Select a school to filter lecture notes instantly</p>
          </div>
          <button
            onClick={() => { setSelectedUniversity(''); triggerToast('Showing notes from all universities.'); }}
            className="text-[var(--marigold)] font-medium text-sm flex items-center gap-1 hover:underline"
          >
            <span>See all</span>
            <ArrowRight size={16} />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 md:gap-3">
          {[{ id: '', name: 'All Universities' }, ...universities].map((uni) => {
            const isSelected = selectedUniversity === uni.id;
            return (
              <button
                key={uni.id || 'all'}
                onClick={() => { setSelectedUniversity(uni.id); setCurrentPage(0); triggerToast(`Selected ${uni.name}`); }}
                className={`px-5 py-2.5 rounded-full border text-sm transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? 'border-[var(--marigold)] bg-[var(--marigold)] text-[#06141B] font-semibold shadow-md scale-102'
                    : 'border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-body)] hover:border-[var(--marigold)] hover:text-[var(--marigold)]'
                }`}
              >
                {uni.name === 'All Universities' ? 'All colleges' : uni.name}
              </button>
            );
          })}
        </div>
      </section>

      {/* Freshly Approved Section */}
      <section id="freshly-approved" className="max-w-[1152px] mx-auto w-full py-10 px-4 md:px-6 border-t border-[var(--border-color)]/20">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h2 className="font-serif text-2xl md:text-3xl text-[var(--text-title)] font-bold">Freshly approved</h2>
            <div className="w-12 h-1 bg-[var(--marigold)] mt-2"></div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-[var(--text-muted)] hidden sm:inline">
              Page {totalPages > 0 ? currentPage + 1 : 0} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button onClick={handlePrevPage} className="p-2 border border-[var(--border-color)] rounded bg-[var(--bg-deep)] text-[var(--text-body)] hover:border-[var(--marigold)] hover:text-[var(--marigold)] transition-colors cursor-pointer" title="Previous Notes" aria-label="Previous page">
                <ChevronLeft size={18} />
              </button>
              <button onClick={handleNextPage} className="p-2 border border-[var(--border-color)] rounded bg-[var(--bg-deep)] text-[var(--text-body)] hover:border-[var(--marigold)] hover:text-[var(--marigold)] transition-colors cursor-pointer" title="Next Notes" aria-label="Next page">
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mb-6 text-xs border-b border-[var(--border-color)]/10 pb-4">
          <button onClick={() => { setSelectedTypeFilter('all'); setCurrentPage(0); }} className={`px-3 py-1.5 rounded-md font-medium transition-all ${selectedTypeFilter === 'all' ? 'bg-[var(--bg-surface)] text-[var(--marigold)] border border-[var(--marigold)]/30' : 'text-[var(--text-muted)] hover:text-[var(--text-title)]'}`}>
            All Material
          </button>
          <button onClick={() => { setSelectedTypeFilter('lecture'); setCurrentPage(0); }} className={`px-3 py-1.5 rounded-md font-medium transition-all ${selectedTypeFilter === 'lecture' ? 'bg-[var(--bg-surface)] text-[var(--marigold)] border border-[var(--marigold)]/30' : 'text-[var(--text-muted)] hover:text-[var(--text-title)]'}`}>
            📝 Lecture Notes
          </button>
          <button onClick={() => { setSelectedTypeFilter('exam'); setCurrentPage(0); }} className={`px-3 py-1.5 rounded-md font-medium transition-all ${selectedTypeFilter === 'exam' ? 'bg-[var(--bg-surface)] text-[var(--marigold)] border border-[var(--marigold)]/30' : 'text-[var(--text-muted)] hover:text-[var(--text-title)]'}`}>
            ❓ Solved Exams
          </button>
          <button onClick={() => { setSelectedTypeFilter('guide'); setCurrentPage(0); }} className={`px-3 py-1.5 rounded-md font-medium transition-all ${selectedTypeFilter === 'guide' ? 'bg-[var(--bg-surface)] text-[var(--marigold)] border border-[var(--marigold)]/30' : 'text-[var(--text-muted)] hover:text-[var(--text-title)]'}`}>
            📚 Study Guides
          </button>
        </div>

        {filteredNotes.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-[var(--border-color)] rounded-xl bg-[var(--bg-surface)]">
            <BookOpen className="mx-auto text-[var(--text-muted)] mb-3" size={40} />
            <h3 className="font-serif text-lg font-bold text-[var(--text-title)]">No study materials found</h3>
            <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto mt-1 px-4">
              We couldn't find any documents matching your filters. Try searching for something else or upload your own files!
            </p>
            <button
              onClick={() => { setSearchQuery(''); setSelectedUniversity(''); setSelectedTypeFilter('all'); }}
              className="mt-4 px-4 py-2 bg-[var(--marigold)] text-[#06141B] font-bold text-xs rounded hover:bg-[var(--marigold-dark)] transition-colors"
            >
              Reset All Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayedNotes.map((note) => (
              <div
                key={note.id}
                onClick={() => { setDownloadingNote(note); setIsViewOpen(false); setDownloadStatus('idle'); setDownloadProgress(0); }}
                className="group bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg p-6 hover:border-[var(--marigold)] transition-all duration-300 hover:-translate-y-1.5 hover:scale-[1.01] relative overflow-hidden flex flex-col justify-between cursor-pointer"
                title="Click to view details and rating menu"
              >
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <div className="stamp"><span>{note.course_code}</span></div>
                    <div className="text-[var(--text-muted)] group-hover:text-[var(--marigold)] transition-colors">
                      {note.material_type === 'lecture' && <FileText size={20} aria-label="Lecture Note" />}
                      {note.material_type === 'exam' && <HelpCircle size={20} aria-label="Solved Exam" />}
                      {note.material_type === 'guide' && <BookOpen size={20} aria-label="Study Guide" />}
                    </div>
                  </div>

                  <h3 className="font-serif text-xl font-bold text-[var(--text-title)] mb-1 group-hover:text-[var(--marigold)] transition-colors line-clamp-1">
                    {note.title}
                  </h3>

                  <div className="flex items-center gap-0.5 mb-2">
                    {[1, 2, 3, 4, 5].map((s) => {
                      const isLit = s <= Math.round(note.avg_rating || 0);
                      return <Star key={s} size={12} fill={isLit ? 'var(--marigold)' : 'none'} className={isLit ? 'text-[var(--marigold)]' : 'text-[var(--text-muted)]/40'} />;
                    })}
                    <span className="text-[10px] font-mono text-[var(--text-muted)] ml-1.5">
                      ({note.ratings_count || 0})
                    </span>
                  </div>

                  <div className="text-[11px] font-mono text-[var(--marigold)] mb-3 font-semibold tracking-wider">
                    {(note.university_name || '').toUpperCase()}
                  </div>

                  <p className="text-sm text-[var(--text-muted)] leading-relaxed mb-4 line-clamp-3">
                    {note.description}
                  </p>
                </div>

                <div className="flex justify-between items-center border-t border-[var(--border-color)]/20 pt-4 mt-auto">
                  <div className="flex flex-col">
                    <span className="text-xs text-[var(--text-muted)]">By {note.author_display_name || 'Anonymous Student'}</span>
                    <span className="text-[10px] text-[var(--text-muted)]/70">{timeAgo(note.created_at)} • {note.downloads_count} downloads</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDownloadingNote(note);
                        setIsViewOpen(false);
                        setDownloadStatus('idle');
                        setDownloadProgress(0);
                        if (!currentUser) {
                          triggerToast('🔒 Downloads are only available to signed-in students!');
                        } else {
                          startDownload(note);
                        }
                      }}
                      className="text-[var(--marigold)] font-bold text-xs uppercase tracking-wider hover:underline flex items-center gap-1 cursor-pointer p-1 rounded"
                    >
                      <Download size={14} />
                      <span>Download</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-10 flex justify-center">
          <button onClick={openUploadModal} className="flex items-center gap-2 bg-[var(--bg-surface)] border border-[var(--border-color)] hover:border-[var(--marigold)] text-[var(--text-title)] px-6 py-3.5 rounded-lg text-sm font-semibold shadow hover:shadow-lg transition-all">
            <Plus size={18} className="text-[var(--marigold)] animate-pulse" />
            <span>Contribute your course notes</span>
          </button>
        </div>
      </section>

      {/* Interactive Download & Details Overlay Modal */}
      {downloadingNote && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[var(--bg-deep)] border-2 border-[var(--border-color)] rounded-xl max-w-xl w-full p-6 md:p-8 shadow-2xl space-y-5 relative overflow-hidden">

            <div className="absolute top-4 right-12 opacity-20 pointer-events-none transform rotate-12">
              <div className="stamp border-red-500 text-red-500 scale-150 p-2 font-bold font-mono">APPROVED</div>
            </div>

            <div className="flex justify-between items-start border-b border-[var(--border-color)]/20 pb-4">
              <div className="space-y-1">
                <span className="text-xs font-mono px-2.5 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border-color)]">{downloadingNote.course_code}</span>
                <h3 className="font-serif text-2xl font-bold text-[var(--text-title)] pt-2 leading-tight">{downloadingNote.title}</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Published for <strong className="text-[var(--marigold)]">{downloadingNote.university_name}</strong> • Verified Course Material
                </p>
              </div>
              <button onClick={() => setDownloadingNote(null)} className="p-1.5 rounded-full hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-title)] transition-colors cursor-pointer" aria-label="Close details">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-1.5">
              <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">About this document</h4>
              <p className="text-sm text-[var(--text-title)] leading-relaxed">{downloadingNote.description}</p>
            </div>

            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/60 rounded-xl p-4 space-y-3">
              <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--marigold)]">Student Review & Ratings</h4>
              <p className="text-xs text-[var(--text-muted)]">Have you studied this material? Click a star below to rate:</p>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex gap-2.5">
                    {[1, 2, 3, 4, 5].map((starValue) => {
                      const isLit = starValue <= Math.round(downloadingNote.avg_rating || 0);
                      return (
                        <button
                          key={starValue}
                          type="button"
                          onClick={() => handleRateNote(downloadingNote.id, starValue)}
                          className="transform hover:scale-125 transition-all text-[var(--marigold)] duration-150 cursor-pointer"
                          title={`Rate ${starValue} Stars`}
                        >
                          <Star size={24} fill={isLit ? 'var(--marigold)' : 'none'} className={isLit ? 'text-[var(--marigold)]' : 'text-[var(--text-muted)]/40'} />
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex justify-between max-w-[172px] text-[10px] font-mono text-[var(--text-muted)]/70 px-0.5">
                  <span>1 (Lowest)</span>
                  <span>5 (Max/Full)</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="bg-[var(--bg-surface)] p-2.5 rounded border border-[var(--border-color)]/50">
                <span className="block text-[10px] font-mono uppercase text-[var(--text-muted)]">Uploader</span>
                <span className="text-xs font-bold text-[var(--text-title)]">{downloadingNote.author_display_name || 'Anonymous Student'}</span>
              </div>
              <div className="bg-[var(--bg-surface)] p-2.5 rounded border border-[var(--border-color)]/50">
                <span className="block text-[10px] font-mono uppercase text-[var(--text-muted)]">Total Downloads</span>
                <span className="text-xs font-bold text-[var(--text-title)] font-mono">{downloadingNote.downloads_count} student copies</span>
              </div>
            </div>

            <div className="space-y-2 border-t border-[var(--border-color)]/20 pt-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                  <BookMarked size={12} />
                  <span>Interactive Draft Preview</span>
                </span>
                <button onClick={() => setIsViewOpen(!isViewOpen)} className="text-xs font-semibold px-3 py-1.5 rounded border border-[var(--border-color)] text-[var(--text-title)] bg-[var(--bg-surface)] hover:border-[var(--marigold)] hover:text-[var(--marigold)] transition-all cursor-pointer flex items-center gap-1">
                  {isViewOpen ? <EyeOff size={13} /> : <Eye size={13} />}
                  <span>{isViewOpen ? 'Hide' : 'View Preview'}</span>
                </button>
              </div>

              <AnimatePresence initial={false}>
                {isViewOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg p-4 text-xs font-mono text-[var(--text-muted)] leading-relaxed max-h-40 overflow-y-auto custom-scrollbar mt-1">
                      <p className="whitespace-pre-wrap">{downloadingNote.content_snippet || 'No document preview was provided. Open full download to view.'}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="space-y-3 pt-2">
              {!currentUser ? (
                <div className="bg-red-500/5 border border-red-500/20 p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <h4 className="text-sm font-bold text-red-500 flex items-center gap-1.5"><span>🔒 Signed-in Users Only</span></h4>
                    <p className="text-xs text-[var(--text-muted)]">PDF downloads are exclusive to registered student accounts.</p>
                  </div>
                  <button
                    onClick={() => { setDownloadingNote(null); setIsSignupOpen(true); }}
                    className="px-4 py-2 bg-[var(--marigold)] hover:bg-[var(--marigold-dark)] text-[#06141B] font-bold text-xs rounded transition-colors shadow flex items-center justify-center gap-1 cursor-pointer self-start sm:self-auto"
                  >
                    <User size={14} />
                    <span>Create Account to Download</span>
                  </button>
                </div>
              ) : (
                <>
                  {downloadStatus === 'idle' ? (
                    <button onClick={() => startDownload(downloadingNote)} className="w-full py-3 bg-[var(--marigold)] text-[#06141B] font-bold text-sm rounded-lg hover:bg-[var(--marigold-dark)] transition-all shadow flex items-center justify-center gap-2 cursor-pointer">
                      <Download size={18} />
                      <span>Request & Download PDF</span>
                    </button>
                  ) : downloadStatus === 'progress' ? (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs font-mono text-[var(--text-muted)]">
                        <span className="flex items-center gap-1">
                          <span className="inline-block w-2 h-2 rounded-full bg-[var(--marigold)] animate-ping"></span>
                          <span>Fetching from Academic Vault...</span>
                        </span>
                        <span>{downloadProgress}%</span>
                      </div>
                      <div className="w-full bg-[var(--bg-surface)] rounded-full h-3 overflow-hidden border border-[var(--border-color)]">
                        <div className="bg-[var(--marigold)] h-full transition-all duration-150 ease-out rounded-full" style={{ width: `${downloadProgress}%` }}></div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-[var(--marigold)]/10 border border-[var(--marigold)]/20 p-4 rounded-lg flex items-center gap-3">
                      <CheckCircle className="text-[var(--marigold)] flex-shrink-0" size={24} />
                      <div>
                        <h4 className="text-sm font-bold text-[var(--text-title)]">Download completed!</h4>
                        <p className="text-xs text-[var(--text-muted)]">Opened in a new tab. Good luck studying! 🚀</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-[var(--border-color)]/20">
              <button onClick={() => setDownloadingNote(null)} className="px-5 py-2.5 rounded bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)]/80 text-sm font-semibold border border-[var(--border-color)] transition-colors cursor-pointer text-[var(--text-title)]">
                Close Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Moderation Queue Modal */}
      {isModerateOpen && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[var(--bg-deep)] border-2 border-[var(--border-color)] rounded-xl max-w-2xl w-full p-6 md:p-8 shadow-2xl space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b border-[var(--border-color)]/20 pb-4">
              <div>
                <h3 className="font-serif text-2xl font-bold text-[var(--text-title)]">Moderation Queue</h3>
                <p className="text-xs text-[var(--text-muted)]">Review pending uploads. Approving awards the uploader +50 XP.</p>
              </div>
              <button onClick={() => setIsModerateOpen(false)} className="p-1.5 rounded-full hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-title)]">
                <X size={20} />
              </button>
            </div>

            {moderationLoading ? (
              <p className="text-sm text-[var(--text-muted)] text-center py-10">Loading queue...</p>
            ) : moderationQueue.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle className="mx-auto text-[var(--marigold)] mb-3" size={32} />
                <p className="text-sm text-[var(--text-muted)]">Nothing pending — the queue is clear.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {moderationQueue.map((material) => (
                  <div key={material.id} className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg p-4 space-y-3">
                    <div className="flex justify-between items-start gap-3">
                      <div>
                        <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--bg-deep)] border border-[var(--border-color)]">{material.course_code}</span>
                        <h4 className="font-serif text-lg font-bold text-[var(--text-title)] mt-1">{material.title}</h4>
                        <p className="text-xs text-[var(--text-muted)]">
                          {material.material_type} • by {material.author_display_name || 'Anonymous Student'} • {timeAgo(material.created_at)}
                        </p>
                      </div>
                      <button onClick={() => previewModeratedFile(material)} className="text-xs font-semibold px-3 py-1.5 rounded border border-[var(--border-color)] text-[var(--text-title)] hover:border-[var(--marigold)] hover:text-[var(--marigold)] transition-all flex items-center gap-1 whitespace-nowrap">
                        <Eye size={13} />
                        <span>View file</span>
                      </button>
                    </div>

                    <p className="text-sm text-[var(--text-body)]">{material.description}</p>
                    {material.content_snippet && (
                      <p className="text-xs font-mono text-[var(--text-muted)] bg-[var(--bg-deep)] border border-[var(--border-color)] rounded p-2 line-clamp-3">
                        {material.content_snippet}
                      </p>
                    )}

                    <div className="flex justify-end gap-2 pt-1">
                      <button onClick={() => handleModerate(material, 'rejected')} className="px-4 py-2 rounded bg-[#3d0d0d] text-[#ff6b6b] hover:bg-[#4d1010] text-xs font-bold transition-colors">
                        Reject
                      </button>
                      <button onClick={() => handleModerate(material, 'approved')} className="px-4 py-2 rounded bg-[var(--marigold)] text-[#06141B] hover:bg-[var(--marigold-dark)] text-xs font-bold transition-colors">
                        Approve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Upload Material Dialog Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <form onSubmit={handleUploadSubmit} className="bg-[var(--bg-deep)] border-2 border-[var(--border-color)] rounded-xl max-w-xl w-full p-6 md:p-8 shadow-2xl space-y-5 relative max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-serif text-2xl font-bold text-[var(--text-title)]">Contribute Study Material</h3>
                <p className="text-xs text-[var(--text-muted)]">Share verified documents to help fellow students and earn academic points.</p>
              </div>
              <button type="button" onClick={() => setIsUploadOpen(false)} className="p-1.5 rounded-full hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-title)]">
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)]">Course Code *</label>
                <input type="text" required placeholder="e.g. CS101" value={newNote.course} onChange={(e) => setNewNote({ ...newNote, course: e.target.value })} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded p-2.5 focus:outline-none focus:border-[var(--marigold)] text-sm" />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)]">Material Type</label>
                <select value={newNote.type} onChange={(e) => setNewNote({ ...newNote, type: e.target.value as 'lecture' | 'exam' | 'guide' })} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded p-2.5 focus:outline-none focus:border-[var(--marigold)] text-sm">
                  <option value="lecture">📝 Lecture Notes</option>
                  <option value="exam">❓ Solved Exam</option>
                  <option value="guide">📚 Study Guide</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)]">University *</label>
              <select required value={newNote.universityId} onChange={(e) => setNewNote({ ...newNote, universityId: e.target.value })} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded p-2.5 focus:outline-none focus:border-[var(--marigold)] text-sm">
                <option value="" disabled>Select university</option>
                {universities.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)]">Document Title *</label>
              <input type="text" required placeholder="e.g. Calculus Midterm Solutions 2026" value={newNote.title} onChange={(e) => setNewNote({ ...newNote, title: e.target.value })} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded p-2.5 focus:outline-none focus:border-[var(--marigold)] text-sm" />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)]">Short Description *</label>
              <textarea required rows={3} placeholder="Briefly state what formulas, topics, or chapters are covered in this study document." value={newNote.description} onChange={(e) => setNewNote({ ...newNote, description: e.target.value })} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded p-2.5 focus:outline-none focus:border-[var(--marigold)] text-sm" />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)]">Attach File *</label>
              <input type="file" required onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded p-2.5 focus:outline-none focus:border-[var(--marigold)] text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-[var(--marigold)] file:text-[#06141B] file:font-bold file:text-xs" />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)]">Content Draft or Table of Contents (for search preview)</label>
              <textarea rows={2} placeholder="Paste some sample text or questions here so others can verify the document contents." value={newNote.contentSnippet} onChange={(e) => setNewNote({ ...newNote, contentSnippet: e.target.value })} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded p-2.5 focus:outline-none focus:border-[var(--marigold)] text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)]">Contributor Name (Optional)</label>
                <input type="text" placeholder={currentUser ? currentUser.name : 'e.g. Sarah J.'} value={newNote.author} onChange={(e) => setNewNote({ ...newNote, author: e.target.value })} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded p-2.5 focus:outline-none focus:border-[var(--marigold)] text-sm" />
              </div>
              <div className="flex items-center text-xs text-[var(--text-muted)] pt-5">
                <span>Earns <strong className="text-[var(--marigold)]">+50 XP</strong> once a moderator approves it!</span>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-[var(--border-color)]/20">
              <button type="button" onClick={() => setIsUploadOpen(false)} className="px-5 py-2.5 rounded bg-[var(--bg-surface)] hover:opacity-90 text-sm font-semibold border border-[var(--border-color)] transition-colors">
                Cancel
              </button>
              <button type="submit" className="px-5 py-2.5 rounded bg-[var(--marigold)] text-[#06141B] hover:bg-[var(--marigold-dark)] text-sm font-bold shadow-lg transition-colors">
                Submit for Review
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Login Modal */}
      {isLoginOpen && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <form onSubmit={handleLoginSubmit} className="bg-[var(--bg-deep)] border-2 border-[var(--border-color)] rounded-xl max-w-sm w-full p-6 md:p-8 shadow-2xl space-y-5">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-serif text-xl font-bold text-[var(--text-title)]">Log in to StudyHub</h3>
                <p className="text-xs text-[var(--text-muted)] mt-1">Access verified notes instantly.</p>
              </div>
              <button type="button" onClick={() => setIsLoginOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-title)]">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">Email address</label>
                <input type="email" required placeholder="student@university.edu" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded p-2.5 text-sm focus:outline-none focus:border-[var(--marigold)]" />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••"
                    value={authForm.password}
                    onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded p-2.5 pr-10 text-sm focus:outline-none focus:border-[var(--marigold)]"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--marigold)] transition-colors cursor-pointer flex items-center justify-center p-1" title={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>

            <button type="submit" className="w-full bg-[var(--marigold)] text-[#06141B] py-2.5 rounded font-bold text-sm hover:bg-[var(--marigold-dark)] transition-colors">
              Log In
            </button>

            <p className="text-center text-xs text-[var(--text-muted)]">
              Don't have an account?{' '}
              <button type="button" onClick={() => { setIsLoginOpen(false); setIsSignupOpen(true); }} className="text-[var(--marigold)] hover:underline font-semibold">
                Sign up
              </button>
            </p>
          </form>
        </div>
      )}

      {/* Signup Modal */}
      {isSignupOpen && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <form onSubmit={handleSignupSubmit} className="bg-[var(--bg-deep)] border-2 border-[var(--border-color)] rounded-xl max-w-sm w-full p-6 md:p-8 shadow-2xl space-y-5">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-serif text-xl font-bold text-[var(--text-title)]">Join StudyHub</h3>
                <p className="text-xs text-[var(--text-muted)] mt-1">Get a 200 XP welcome bonus immediately.</p>
              </div>
              <button type="button" onClick={() => setIsSignupOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-title)]">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">Full Name</label>
                <input type="text" required placeholder="e.g. Sarah Jenkins" value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded p-2.5 text-sm focus:outline-none focus:border-[var(--marigold)]" />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">Email</label>
                <input type="email" required placeholder="you@example.com" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded p-2.5 text-sm focus:outline-none focus:border-[var(--marigold)]" />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    placeholder="Choose a strong password"
                    value={authForm.password}
                    onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded p-2.5 pr-10 text-sm focus:outline-none focus:border-[var(--marigold)]"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--marigold)] transition-colors cursor-pointer flex items-center justify-center p-1" title={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>

            <button type="submit" className="w-full bg-[var(--marigold)] text-[#06141B] py-2.5 rounded font-bold text-sm hover:bg-[var(--marigold-dark)] transition-colors">
              Create Free Account
            </button>

            <p className="text-center text-xs text-[var(--text-muted)]">
              Already have an account?{' '}
              <button type="button" onClick={() => { setIsSignupOpen(false); setIsLoginOpen(true); }} className="text-[var(--marigold)] hover:underline font-semibold">
                Log in
              </button>
            </p>
          </form>
        </div>
      )}

      {/* Footer */}
      <footer id="footer" className="bg-[var(--bg-surface)] border-t border-[var(--border-color)]/30 w-full mt-20">
        <div className="max-w-[1152px] mx-auto py-12 px-4 md:px-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
          <div className="space-y-3">
            <span className="font-serif text-2xl font-bold text-[var(--text-title)] block">StudyHub</span>
            <p className="text-sm text-[var(--text-muted)] max-w-sm leading-relaxed">
              © 2026 StudyHub. Built by students for students. Maintaining the quiet focus of academic rigor.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-12">
            <div className="flex flex-col gap-3">
              <span className="font-mono text-xs text-[var(--marigold)] uppercase tracking-wider font-semibold">Platform</span>
              <button
                onClick={() => { setSelectedUniversity(''); setSelectedTypeFilter('all'); setSearchQuery(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="text-sm text-[var(--text-muted)] hover:text-[var(--marigold)] transition-colors text-left"
              >
                Browse All
              </button>
              <button onClick={() => { document.getElementById('browse-universities')?.scrollIntoView({ behavior: 'smooth' }); }} className="text-sm text-[var(--text-muted)] hover:text-[var(--marigold)] transition-colors text-left">
                Schools
              </button>
              <button onClick={() => triggerToast('Contribute lecture materials to be listed as a star contributor!')} className="text-sm text-[var(--text-muted)] hover:text-[var(--marigold)] transition-colors text-left">
                Contributors
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <span className="font-mono text-xs text-[var(--marigold)] uppercase tracking-wider font-semibold">Legal</span>
              <button onClick={() => triggerToast('StudyHub Terms of Use: Keep uploads honest, authentic, and free of copyright infringements.')} className="text-sm text-[var(--text-muted)] hover:text-[var(--marigold)] transition-colors text-left">
                Terms
              </button>
              <button onClick={() => triggerToast('Your files and uploads remain private until verified and catalogued.')} className="text-sm text-[var(--text-muted)] hover:text-[var(--marigold)] transition-colors text-left">
                Privacy
              </button>
              <button onClick={() => triggerToast('Need support? Reach out at kidus00t@gmail.com')} className="text-sm text-[var(--text-muted)] hover:text-[var(--marigold)] transition-colors text-left">
                Support
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}