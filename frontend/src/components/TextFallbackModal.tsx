import React, { useState } from 'react';
import { Keyboard, X, Send } from 'lucide-react';

interface TextFallbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

export const TextFallbackModal: React.FC<TextFallbackModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  disabled = false,
}) => {
  const [text, setText] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    onSubmit(text.trim());
    setText('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700/80 p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-950 border border-indigo-700 text-indigo-300">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-base">Text Fallback Response</h3>
              <p className="text-xs text-slate-400">Type your answer if your microphone is encountering issues.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="fallback-text" className="block text-xs font-medium text-slate-300 mb-1.5">
              Your Answer
            </label>
            <textarea
              id="fallback-text"
              rows={5}
              required
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type your response to the current interview question..."
              className="w-full rounded-xl bg-slate-950 border border-slate-700 p-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
            <div className="flex justify-between items-center text-[11px] text-slate-500 mt-1">
              <span>Supports comprehensive paragraph responses</span>
              <span>{text.length} chars</span>
            </div>
          </div>

          <div className="flex justify-end items-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!text.trim() || disabled}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white shadow-md transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Submit Typed Answer</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
