import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import ExamForm from '../components/ExamForm';
import Toast from '../components/Toast';
import { Plus, Calendar as CalendarIcon, MapPin, Clock, Edit2, Trash2, Download, AlertCircle, LayoutGrid, List, Award } from 'lucide-react';
import { format, differenceInDays, isSameDay, parseISO } from 'date-fns';
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
      setToast({ message: `You have ${upcomingSoon.length} exams coming up within 3 days! Keep studying.`, type: 'info' });
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

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-800 dark:text-white">Exam Timetable</h2>
          <p className="text-slate-600 dark:text-slate-400">Plan your revision and keep track of upcoming assessments.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setView(view === 'list' ? 'calendar' : 'list')}
            className="flex items-center px-4 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
          >
            {view === 'list' ? <><LayoutGrid size={18} className="mr-2" /> Calendar</> : <><List size={18} className="mr-2" /> List</>}
          </button>
          <button
            onClick={exportPDF}
            className="flex items-center px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
          >
            <Download size={18} className="mr-2" /> Export PDF
          </button>
          <button
            onClick={() => { setEditingExam(null); setIsFormOpen(true); }}
            className="flex items-center px-4 py-2 bg-medical-600 hover:bg-medical-700 text-white rounded-lg transition-colors"
          >
            <Plus size={18} className="mr-2" /> Add Exam
          </button>
        </div>
      </div>

      <div ref={timetableRef} className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
        {view === 'list' ? (
          <>
            <div className="hidden md:grid grid-cols-5 gap-4 pb-4 border-b border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-500 dark:text-slate-400">
              <div className="col-span-2">Course Title</div>
              <div>Date & Time</div>
              <div>Venue</div>
              <div className="text-right">Status</div>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {sortedExams.length > 0 ? sortedExams.map((exam) => (
                <div key={exam.id} className="grid grid-cols-1 md:grid-cols-5 gap-4 py-6 items-center group">
                  <div className="md:col-span-2">
                    <h4 className="font-bold text-lg group-hover:text-medical-600 transition-colors">{exam.title}</h4>
                    <div className="flex md:hidden items-center mt-2 space-x-4 text-sm text-slate-500">
                      <span className="flex items-center"><CalendarIcon size={14} className="mr-1"/> {format(new Date(exam.date), 'MMM dd')}</span>
                      <span className="flex items-center"><Clock size={14} className="mr-1"/> {exam.time}</span>
                    </div>
                  </div>

                  <div className="hidden md:block">
                    <div className="flex items-center text-sm font-medium">
                      <CalendarIcon size={16} className="mr-2 text-slate-400" />
                      {format(new Date(exam.date), 'EEEE, MMM dd, yyyy')}
                    </div>
                    <div className="flex items-center text-sm text-slate-500 mt-1">
                      <Clock size={16} className="mr-2 text-slate-400" />
                      {exam.time}
                    </div>
                  </div>

                  <div className="flex items-center text-sm text-slate-600 dark:text-slate-400">
                    <MapPin size={16} className="mr-2 text-slate-400" />
                    {exam.venue}
                  </div>

                  <div className="flex flex-col items-end space-y-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${getStatusColor(exam.date)}`}>
                      {getStatusLabel(exam.date)}
                    </span>
                    <span className="text-xs font-medium text-slate-500">
                      {getCountdown(exam.date)}
                    </span>
                    <div className="flex space-x-2 pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEdit(exam)} className="p-1 hover:text-medical-600"><Edit2 size={16}/></button>
                      <button onClick={() => deleteExam(exam.id)} className="p-1 hover:text-red-500"><Trash2 size={16}/></button>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="py-20 text-center">
                  <CalendarIcon className="mx-auto text-slate-300 mb-4" size={48} />
                  <p className="text-slate-500 text-lg">Your exam timetable is empty.</p>
                  <button
                    onClick={() => setIsFormOpen(true)}
                    className="mt-4 text-medical-600 font-semibold hover:underline"
                  >
                    Schedule your first exam
                  </button>
                </div>
              )}
            </div>
          </>
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
