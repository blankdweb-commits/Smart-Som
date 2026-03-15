import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import ExamForm from '../components/ExamForm';
import Toast from '../components/Toast';
import { Plus, Calendar as CalendarIcon, MapPin, Clock, Edit2, Trash2, Download, AlertCircle, LayoutGrid, List, Award } from 'lucide-react';
import { format, differenceInDays, isSameDay } from 'date-fns';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';

const ExamTimetable = () => {
  const { exams, addExam, updateExam, deleteExam } = useAppContext();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExam, setEditingExam] = useState(null);
  const [view, setView] = useState('list'); // 'list' or 'calendar'
  const [toast, setToast] = useState(null);
  const timetableRef = useRef();

  useEffect(() => {
    const upcomingSoon = exams.filter(e => {
      const diff = differenceInDays(new Date(e.date), new Date());
      return diff >= 0 && diff <= 3;
    });
    if (upcomingSoon.length > 0) {
      // Use setTimeout to avoid synchronous setState in effect warning if necessary,
      // or just ensure we're not causing a loop.
      const timer = setTimeout(() => {
        setToast({ message: `You have ${upcomingSoon.length} exams coming up within 3 days! Keep studying.`, type: 'info' });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [exams]);

  const getStatusColor = (date) => {
    const today = new Date();
    const examDate = new Date(date);
    const diff = differenceInDays(examDate, today);

    if (isSameDay(examDate, today)) return 'bg-red-500 text-white';
    if (diff > 0 && diff <= 3) return 'bg-yellow-500 text-white';
    return 'bg-green-500 text-white';
  };

  const getStatusLabel = (date) => {
    const today = new Date();
    const examDate = new Date(date);
    const diff = differenceInDays(examDate, today);

    if (isSameDay(examDate, today)) return 'Today';
    if (diff > 0 && diff <= 3) return 'In 3 Days';
    return 'Upcoming';
  };

  const getCountdown = (date) => {
    const today = new Date();
    const examDate = new Date(date);
    const diff = differenceInDays(examDate, today);
    if (diff < 0) return 'Passed';
    if (diff === 0) return 'Today!';
    return `${diff} days left`;
  };

  const handleEdit = (exam) => {
    setEditingExam(exam);
    setIsFormOpen(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Are you sure you want to delete this exam?')) {
      deleteExam(id);
      setToast({ message: 'Exam deleted successfully', type: 'success' });
    }
  };

  const handleFormSubmit = (data) => {
    if (editingExam) {
      updateExam(editingExam.id, data);
    } else {
      addExam(data);
    }
    setEditingExam(null);
  };

  const exportPDF = async () => {
    const element = timetableRef.current;
    const canvas = await html2canvas(element, {
      scale: 2,
      backgroundColor: document.documentElement.classList.contains('dark') ? '#0f172a' : '#ffffff'
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save('exam-timetable.pdf');
  };

  const sortedExams = [...exams].sort((a, b) => new Date(a.date) - new Date(b.date));

  // Cross-referencing logic: Find matching subjects in flashcards
  const { flashcards } = useAppContext();
  const getRevisionSuggestions = (examTitle) => {
    const title = examTitle.toLowerCase();
    const subjects = [...new Set(flashcards.map(c => c.subject))];
    return subjects.filter(s => title.includes(s.toLowerCase()) || s.toLowerCase().includes(title));
  };

  const soonestExam = sortedExams.find(e => new Date(e.date) >= new Date());

  return (
    <div className="space-y-6 pb-20">
      <header>
        <h2 className="text-3xl font-bold text-slate-800 dark:text-white">Exam Timetable</h2>
        <p className="text-slate-600 dark:text-slate-400">Keep track of your clinical and academic assessments.</p>
      </header>

      {soonestExam && differenceInDays(new Date(soonestExam.date), new Date()) <= 7 && (
        <div className="bg-gradient-to-r from-medical-600 to-indigo-600 p-4 rounded-xl text-white shadow-md flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Clock size={24} className="opacity-80" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wider opacity-80">Next Assessment</p>
              <h3 className="text-lg font-bold">{soonestExam.title}</h3>
            </div>
          </div>
          <div className="text-right text-xs font-bold">
            {differenceInDays(new Date(soonestExam.date), new Date())} Days Remaining
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
          <button
            onClick={() => setView('list')}
            className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${view === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-medical-600' : 'text-slate-500'}`}
          >
            List View
          </button>
          <button
            onClick={() => setView('calendar')}
            className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${view === 'calendar' ? 'bg-white dark:bg-slate-700 shadow-sm text-medical-600' : 'text-slate-500'}`}
          >
            Calendar
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={exportPDF}
            className="flex items-center px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-200"
          >
            <Download size={16} className="mr-2" /> PDF
          </button>
          <button
            onClick={() => { setEditingExam(null); setIsFormOpen(true); }}
            className="flex items-center px-4 py-2 bg-medical-600 hover:bg-medical-700 text-white rounded-lg text-sm font-bold"
          >
            <Plus size={16} className="mr-2" /> Add Exam
          </button>
        </div>
      </div>

      <div ref={timetableRef} className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 overflow-hidden">
        {view === 'list' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/50">
                  <th className="px-6 py-5 text-xs font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 dark:border-slate-700">Course & Venue</th>
                  <th className="px-6 py-5 text-xs font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 dark:border-slate-700">Schedule (Local Time)</th>
                  <th className="px-6 py-5 text-xs font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 dark:border-slate-700">Countdown</th>
                  <th className="px-6 py-5 text-xs font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 dark:border-slate-700 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
                {sortedExams.length > 0 ? sortedExams.map((exam) => {
                  const examDate = new Date(exam.date);
                  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

                  return (
                    <tr key={exam.id} className="group hover:bg-medical-50/30 dark:hover:bg-medical-900/10 transition-colors">
                      <td className="px-6 py-6">
                        <div className="flex flex-col gap-1">
                          <span className="text-lg font-black text-slate-800 dark:text-white group-hover:text-medical-600 transition-colors">{exam.title}</span>
                          <div className="flex items-center text-xs font-bold text-slate-400 uppercase tracking-tight">
                            <MapPin size={12} className="mr-1" />
                            {exam.venue}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-6">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
                            <CalendarIcon size={14} className="text-medical-500" />
                            {format(examDate, 'EEE, MMM dd, yyyy')}
                          </div>
                          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                            <Clock size={14} />
                            {exam.time} <span className="opacity-60">({timezone.split('/')[1]?.replace('_', ' ') || timezone})</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-6">
                        <div className="flex flex-col gap-1.5">
                          <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest w-fit shadow-sm ${getStatusColor(exam.date)}`}>
                            <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                            {getStatusLabel(exam.date)}
                          </div>
                          <span className="text-xs font-bold text-slate-500 ml-1">
                            {getCountdown(exam.date)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-6 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                          <button
                            onClick={() => handleEdit(exam)}
                            className="p-2.5 bg-white dark:bg-slate-700 text-slate-400 hover:text-medical-600 hover:shadow-soft rounded-xl transition-all border border-slate-100 dark:border-slate-600"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(exam.id)}
                            className="p-2.5 bg-white dark:bg-slate-700 text-slate-400 hover:text-red-500 hover:shadow-soft rounded-xl transition-all border border-slate-100 dark:border-slate-600"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan="4" className="py-24 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-20 h-20 bg-slate-50 dark:bg-slate-900 rounded-full flex items-center justify-center text-slate-200">
                          <CalendarIcon size={40} />
                        </div>
                        <div className="space-y-1">
                          <p className="text-lg font-black text-slate-300 uppercase tracking-widest">No Exams Scheduled</p>
                          <p className="text-slate-400 text-sm font-medium italic">"Preparation is the key to clinical excellence."</p>
                        </div>
                        <button
                          onClick={() => setIsFormOpen(true)}
                          className="mt-4 px-6 py-3 bg-medical-600 hover:bg-medical-700 text-white rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 shadow-lg shadow-medical-600/20"
                        >
                          Schedule First Exam
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col md:flex-row gap-8">
            <div className="flex-1">
              <Calendar
                className="w-full border-none shadow-none dark:bg-slate-800 dark:text-white"
                tileClassName={({ date, view }) => {
                  if (view === 'month') {
                    const hasExam = exams.find(e => isSameDay(new Date(e.date), date));
                    if (hasExam) {
                      return 'bg-medical-100 dark:bg-medical-900/40 text-medical-700 dark:text-medical-300 font-bold rounded-full';
                    }
                  }
                }}
              />
            </div>
            <div className="w-full md:w-80 space-y-4">
              <h4 className="font-bold text-slate-700 dark:text-slate-300 border-b pb-2">Exam Schedule</h4>
              {sortedExams.length > 0 ? sortedExams.map(exam => (
                <div key={exam.id} className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg border-l-4 border-medical-500">
                  <p className="font-bold text-sm">{exam.title}</p>
                  <p className="text-xs text-slate-500 mt-1">{format(new Date(exam.date), 'MMM dd')} at {exam.time}</p>
                </div>
              )) : (
                <p className="text-sm text-slate-500 italic">No exams scheduled.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Revision Suggestions */}
      {exams.length > 0 && (
        <div className="mt-8 bg-indigo-50 dark:bg-indigo-900/10 p-6 rounded-2xl border border-indigo-100 dark:border-indigo-900/30">
          <div className="flex items-center gap-2 mb-4">
            <Award className="text-indigo-600" size={24} />
            <h3 className="text-xl font-bold text-slate-800 dark:text-white">Smart Revision Assistant</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedExams.filter(e => differenceInDays(new Date(e.date), new Date()) >= 0).slice(0, 3).map(exam => {
              const suggestions = getRevisionSuggestions(exam.title);
              return (
                <div key={exam.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-indigo-50 dark:border-indigo-900/20">
                  <p className="font-bold text-slate-800 dark:text-white mb-2">{exam.title}</p>
                  {suggestions.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-500 uppercase font-bold tracking-tight">Recommended Decks:</p>
                      <div className="flex flex-wrap gap-2">
                        {suggestions.map(s => (
                          <span key={s} className="px-2 py-1 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded text-xs font-medium">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic">No matching flashcards found. Create some for better preparation!</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        <div className="p-4 bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30 rounded-xl flex items-start">
          <AlertCircle className="text-green-600 mr-3 shrink-0" size={20} />
          <div>
            <p className="text-sm font-bold text-green-800 dark:text-green-400 uppercase">Upcoming</p>
            <p className="text-xs text-green-700 dark:text-green-500 mt-1">Exams scheduled more than 3 days away. Plenty of time to revise!</p>
          </div>
        </div>
        <div className="p-4 bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-100 dark:border-yellow-900/30 rounded-xl flex items-start">
          <AlertCircle className="text-yellow-600 mr-3 shrink-0" size={20} />
          <div>
            <p className="text-sm font-bold text-yellow-800 dark:text-yellow-400 uppercase">Within 3 Days</p>
            <p className="text-xs text-yellow-700 dark:text-yellow-500 mt-1">Almost here! Focus on high-yield topics and summary notes.</p>
          </div>
        </div>
        <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl flex items-start">
          <AlertCircle className="text-red-600 mr-3 shrink-0" size={20} />
          <div>
            <p className="text-sm font-bold text-red-800 dark:text-red-400 uppercase">Today</p>
            <p className="text-xs text-red-700 dark:text-red-500 mt-1">Stay calm, stay hydrated, and trust your preparation. Good luck!</p>
          </div>
        </div>
      </div>

      <ExamForm
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingExam(null); }}
        onSubmit={handleFormSubmit}
        initialData={editingExam}
      />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default ExamTimetable;
