import React, { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Briefcase,
  ArrowLeft,
  FileText,
  UploadCloud,
  X,
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
  Sliders,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { createSession, uploadResume } from '../services/api';
import { logDiagnostic } from '../services/diagnostics';
import type { SessionMetadata } from '../types';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS = ['.pdf', '.docx'];

export const CreateSession: React.FC = () => {
  const navigate = useNavigate();

  // Form Fields
  const [jobTitle, setJobTitle] = useState('');
  const [jdText, setJdText] = useState('');
  const [questionCount, setQuestionCount] = useState<number>(8);
  const [difficulty, setDifficulty] = useState<string>('Mid-level');
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [candidateName, setCandidateName] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');

  // Resume Upload State
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form State
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ jobTitle?: string; jdText?: string; email?: string }>({});

  // Success Modal
  const [createdSession, setCreatedSession] = useState<SessionMetadata | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Validate File
  const validateAndSetFile = (file: File) => {
    setFileError(null);

    const lowerName = file.name.toLowerCase();
    const isValidExt = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));

    if (!isValidExt) {
      setFileError('Unsupported file type. Please upload a PDF or DOCX file (AC-003).');
      return false;
    }

    if (file.size > MAX_FILE_SIZE) {
      setFileError(`File exceeds maximum 10MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB detected).`);
      return false;
    }

    setResumeFile(file);
    return true;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      validateAndSetFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      validateAndSetFile(file);
    }
  };

  const handleRemoveFile = () => {
    setResumeFile(null);
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const validateForm = (): boolean => {
    const errors: { jobTitle?: string; jdText?: string; email?: string } = {};

    if (!jobTitle.trim()) {
      errors.jobTitle = 'Job title is required.';
    }

    if (!jdText.trim()) {
      errors.jdText = 'Job description is required to generate interview topics.';
    } else if (jdText.trim().length < 20) {
      errors.jdText = 'Please provide a more descriptive job requirements summary (at least 20 characters).';
    }

    if (candidateEmail.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(candidateEmail.trim())) {
        errors.email = 'Please enter a valid email address.';
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!validateForm()) {
      return;
    }

    setSubmitting(true);
    try {
      // 1. Create Session
      const session = await createSession({
        job_title: jobTitle.trim(),
        jd_text: jdText.trim(),
        question_count: questionCount,
        difficulty,
        duration_minutes: durationMinutes,
        candidate_name: candidateName.trim() || undefined,
        candidate_email: candidateEmail.trim() || undefined,
      });

      // 2. Upload Resume if provided
      if (resumeFile) {
        try {
          await uploadResume(session.id, resumeFile);
        } catch {
          logDiagnostic('warn', 'http_error', { operation: 'resume_upload', outcome: 'failure' });
          // Session was created; display error notice or note it
        }
      }

      setCreatedSession(session);
      // Open native modal dialog
      if (dialogRef.current) {
        if (typeof dialogRef.current.showModal === 'function') {
          dialogRef.current.showModal();
        } else {
          dialogRef.current.setAttribute('open', '');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create interview session';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!createdSession) return;
    const inviteUrl = `${window.location.origin}/interview/${createdSession.token}`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(inviteUrl);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = inviteUrl;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // fallback
    }
  };

  const handleCloseModal = () => {
    if (dialogRef.current) {
      if (typeof dialogRef.current.close === 'function') {
        dialogRef.current.close();
      } else {
        dialogRef.current.removeAttribute('open');
      }
    }
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Dashboard</span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Step 1 of 1:</span>
            <span className="text-xs font-semibold text-indigo-400">Configure & Generate</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 flex-1 w-full">
        <div className="space-y-6">
          {/* Title Banner */}
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-950/80 border border-indigo-800 text-xs font-semibold text-indigo-300">
              <Briefcase className="w-3.5 h-3.5 text-indigo-400" />
              <span>New Screening Interview</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-100">
              Create Interview Session
            </h1>
            <p className="text-xs sm:text-sm text-slate-400">
              Configure job parameters, upload candidate resume, and generate an automated AI screening link.
            </p>
          </div>

          {/* Form Error Banner */}
          {formError && (
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-400 mt-0.5" />
              <div className="text-xs flex-1">
                <p className="font-semibold text-rose-200">Creation Failed</p>
                <p className="mt-1 text-rose-300/80">{formError}</p>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-8" noValidate>
            {/* Section 1: Job Description */}
            <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <FileText className="w-4 h-4 text-indigo-400" />
                <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                  Role & Requirements
                </h2>
              </div>

              {/* Job Title */}
              <div className="space-y-1.5">
                <label htmlFor="jobTitle" className="block text-xs font-semibold text-slate-300">
                  Job Title <span className="text-rose-400">*</span>
                </label>
                <input
                  id="jobTitle"
                  type="text"
                  placeholder="e.g. Senior Backend Engineer (Python / Distributed Systems)"
                  value={jobTitle}
                  onChange={(e) => {
                    setJobTitle(e.target.value);
                    if (fieldErrors.jobTitle) setFieldErrors({ ...fieldErrors, jobTitle: undefined });
                  }}
                  className={`w-full bg-slate-950 border ${
                    fieldErrors.jobTitle ? 'border-rose-500' : 'border-slate-800'
                  } rounded-xl px-4 py-2.5 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors`}
                  aria-required="true"
                  aria-invalid={!!fieldErrors.jobTitle}
                  aria-describedby={fieldErrors.jobTitle ? 'jobTitle-error' : undefined}
                />
                {fieldErrors.jobTitle && (
                  <p id="jobTitle-error" className="text-xs text-rose-400 flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3 h-3" />
                    {fieldErrors.jobTitle}
                  </p>
                )}
              </div>

              {/* Job Description */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="jdText" className="block text-xs font-semibold text-slate-300">
                    Job Description <span className="text-rose-400">*</span>
                  </label>
                  <span className="text-[11px] text-slate-500">
                    {jdText.length} characters
                  </span>
                </div>
                <textarea
                  id="jdText"
                  rows={6}
                  placeholder={`Paste the job description or competency criteria here. The AI interview brain uses this as the primary ground truth to synthesize topics and technical questions.\n\nExample:\nWe are seeking a Senior Backend Engineer proficient in Python, FastAPI, relational databases, and asynchronous task processing. Candidate should have 5+ years of experience building resilient microservices.`}
                  value={jdText}
                  onChange={(e) => {
                    setJdText(e.target.value);
                    if (fieldErrors.jdText) setFieldErrors({ ...fieldErrors, jdText: undefined });
                  }}
                  className={`w-full bg-slate-950 border ${
                    fieldErrors.jdText ? 'border-rose-500' : 'border-slate-800'
                  } rounded-xl p-4 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors leading-relaxed font-sans`}
                  aria-required="true"
                  aria-invalid={!!fieldErrors.jdText}
                  aria-describedby={fieldErrors.jdText ? 'jdText-error' : undefined}
                />
                {fieldErrors.jdText && (
                  <p id="jdText-error" className="text-xs text-rose-400 flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3 h-3" />
                    {fieldErrors.jdText}
                  </p>
                )}
              </div>
            </div>

            {/* Section 2: Interview Configuration */}
            <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                  Interview Parameters
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {/* Question Count Slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="questionCount" className="block text-xs font-semibold text-slate-300">
                      Target Questions
                    </label>
                    <span className="text-xs font-bold text-indigo-400 bg-indigo-950/80 border border-indigo-800 px-2 py-0.5 rounded-md">
                      {questionCount} questions
                    </span>
                  </div>
                  <input
                    id="questionCount"
                    type="range"
                    min={5}
                    max={15}
                    step={1}
                    value={questionCount}
                    onChange={(e) => setQuestionCount(Number(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none"
                    aria-label="Target question count"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>5 (Short)</span>
                    <span>8 (Standard)</span>
                    <span>15 (Deep)</span>
                  </div>
                </div>

                {/* Difficulty Select */}
                <div className="space-y-1.5">
                  <label htmlFor="difficulty" className="block text-xs font-semibold text-slate-300">
                    Difficulty Level
                  </label>
                  <select
                    id="difficulty"
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs sm:text-sm text-slate-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                  >
                    <option value="Junior">Junior</option>
                    <option value="Mid-level">Mid-level (Default)</option>
                    <option value="Senior">Senior</option>
                    <option value="Lead">Lead / Principal</option>
                  </select>
                </div>

                {/* Duration Cap */}
                <div className="space-y-1.5">
                  <label htmlFor="durationMinutes" className="block text-xs font-semibold text-slate-300">
                    Duration Cap
                  </label>
                  <select
                    id="durationMinutes"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs sm:text-sm text-slate-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                  >
                    <option value={15}>15 Minutes</option>
                    <option value={30}>30 Minutes (Default)</option>
                    <option value={45}>45 Minutes</option>
                    <option value={60}>60 Minutes</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Section 3: Optional Candidate Info & Resume Upload */}
            <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                  Candidate Info & Resume (Optional)
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Candidate Name */}
                <div className="space-y-1.5">
                  <label htmlFor="candidateName" className="block text-xs font-semibold text-slate-300">
                    Candidate Name (Optional)
                  </label>
                  <input
                    id="candidateName"
                    type="text"
                    placeholder="e.g. Alex Morgan"
                    value={candidateName}
                    onChange={(e) => setCandidateName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                  />
                </div>

                {/* Candidate Email */}
                <div className="space-y-1.5">
                  <label htmlFor="candidateEmail" className="block text-xs font-semibold text-slate-300">
                    Candidate Email (Optional)
                  </label>
                  <input
                    id="candidateEmail"
                    type="email"
                    placeholder="alex@example.com"
                    value={candidateEmail}
                    onChange={(e) => {
                      setCandidateEmail(e.target.value);
                      if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: undefined });
                    }}
                    className={`w-full bg-slate-950 border ${
                      fieldErrors.email ? 'border-rose-500' : 'border-slate-800'
                    } rounded-xl px-3 py-2.5 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors`}
                  />
                  {fieldErrors.email && (
                    <p className="text-xs text-rose-400 flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {fieldErrors.email}
                    </p>
                  )}
                </div>
              </div>

              {/* Resume Dropzone */}
              <div className="space-y-2 pt-2">
                <span className="block text-xs font-semibold text-slate-300">
                  Upload Candidate Resume (PDF / DOCX, max 10MB)
                </span>

                {resumeFile ? (
                  /* Attached File Card */
                  <div className="p-4 rounded-xl bg-slate-950 border border-indigo-500/40 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-indigo-950 border border-indigo-800 text-indigo-400 flex items-center justify-center shrink-0">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate">
                          {resumeFile.name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {formatFileSize(resumeFile.size)} • Ready for AI parsing
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveFile}
                      title="Remove attached resume"
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-400 transition-colors shrink-0"
                      aria-label="Remove resume file"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  /* Drag & Drop Area */
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    className={`rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition-all ${
                      isDragging
                        ? 'border-indigo-400 bg-indigo-950/20'
                        : 'border-slate-800 hover:border-slate-700 bg-slate-950/60'
                    }`}
                    aria-label="Resume upload dropzone"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={handleFileChange}
                      className="hidden"
                      data-testid="resume-file-input"
                    />
                    <div className="w-12 h-12 rounded-xl bg-slate-800/80 text-indigo-400 mx-auto flex items-center justify-center mb-3">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <p className="text-xs sm:text-sm font-semibold text-slate-200">
                      Drag and drop candidate resume here, or <span className="text-indigo-400 underline">browse</span>
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Supported formats: PDF, DOCX (Max 10MB)
                    </p>
                  </div>
                )}

                {/* File Error Alert */}
                {fileError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-950/50 border border-rose-800/60 text-rose-300 text-xs flex items-center gap-2"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{fileError}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Submission Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <Link
                to="/"
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs sm:text-sm font-medium transition-colors"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-indigo-950 transition-all"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Creating Interview...</span>
                  </>
                ) : (
                  <>
                    <Briefcase className="w-4 h-4" />
                    <span>Create & Generate Link</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </main>

      {/* Success Modal (Native Dialog compliant with modern-web-guidance) */}
      <dialog
        ref={dialogRef}
        aria-labelledby="success-modal-title"
        className="backdrop:bg-slate-950/80 backdrop:backdrop-blur-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-lg w-full text-slate-100 shadow-2xl m-auto"
      >
        {createdSession && (
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-950/80 border border-emerald-800 text-emerald-400 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 id="success-modal-title" className="text-xl font-bold text-slate-100">
                  Interview Session Created!
                </h3>
                <p className="text-xs text-slate-400">
                  Share the link below with your candidate to begin their autonomous AI screening.
                </p>
              </div>
            </div>

            {/* Session Summary Box */}
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Job Title:</span>
                <span className="font-semibold text-slate-200">{createdSession.job_title}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Difficulty:</span>
                <span className="font-semibold text-slate-200">{createdSession.difficulty}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Questions / Duration:</span>
                <span className="font-semibold text-slate-200">
                  {createdSession.question_count} questions / {createdSession.duration_minutes} min
                </span>
              </div>
            </div>

            {/* Candidate Invite Link Box */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-300">
                Candidate Invitation URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}/interview/${createdSession.token}`}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-indigo-300 select-all focus:outline-none"
                />
                <button
                  type="button"
                  autoFocus
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shrink-0 transition-colors shadow-md shadow-indigo-950"
                  aria-label="Copy invitation link"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Link</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
              <a
                href={`/interview/${createdSession.token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
              >
                <span>Join as Candidate</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                type="button"
                onClick={handleCloseModal}
                className="w-full sm:w-auto px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
};
