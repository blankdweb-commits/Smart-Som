import React, { useState, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import ExamDashboard from '../components/ExamDashboard';
import ExamCard from '../components/ExamCard';
import ExamForm from '../components/ExamForm';
import Toast from '../components/Toast';
import { Plus, Download, Calendar as CalendarIcon, List, Share2, AlertCircle, Clock, CheckCircle2 } from '../components/Icons';
import { format, isSameDay, parseISO } from 'date-fns';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
  // eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';

const ExamTimetable = () => {
  const { exams, addExam, updateExam, deleteExam } = useAppContext();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExam, setEditingExam] = useState(null);
  const [view, setView] = useState('list'); // 'list' or 'calendar'
  const [toast, setToast] = useState(null);
  const timetableRef = useRef();

  const handleEdit = (exam) => {
    setEditingExam(exam);
    setIsFormOpen(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Permanent removal of this assessment?')) {
      deleteExam(id);
      setToast({ message: 'Assessment removed', type: 'success' });
    }
  };

  const handleUpdateReadiness = (id, readiness) => {
    const exam = exams.find(e => e.id === id);
    if (exam) updateExam(id, { ...exam, readiness });
  };

  const handleToggleTopic = (examId, topicIdx) => {
    const exam = exams.find(e => e.id === examId);
    if (exam) {
      const newTopics = [...exam.topics];
      newTopics[topicIdx] = { ...newTopics[topicIdx], completed: !newTopics[topicIdx].completed };

      // Auto-update readiness based on topics if topics exist
      const completedCount = newTopics.filter(t => t.completed).length;
      const readiness = Math.round((completedCount / newTopics.length) * 100);

      updateExam(examId, { ...exam, topics: newTopics, readiness });
    }
  };

  const handleFormSubmit = (data) => {
    if (editingExam) updateExam(editingExam.id, data);
    else addExam(data);
    setEditingExam(null);
    setToast({ message: 'Timetable updated successfully!', type: 'success' });
  };

  const exportPDF = async () => {
    setToast({ message: 'Generating clinical report...', type: 'info' });
    const element = timetableRef.current;
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: document.documentElement.classList.contains('dark') ? '#0f172a' : '#ffffff'
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save('nursinghub-exam-timetable.pdf');
    setToast({ message: 'Download ready!', type: 'success' });
  };

  const sortedExams = [...exams].sort((a, b) => parseISO(a.date) - parseISO(b.date));

  return (
    <div className="space-y-10 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Exam Central</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Manage your academic milestones and readiness.</p>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <button
            onClick={exportPDF}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-4 bg-white dark:bg-slate-800 rounded-2xl font-black uppercase tracking-widest text-xs border border-slate-100 dark:border-slate-700 shadow-soft active:scale-95 transition-all"
          >
            <Download size={18} /> Export
          </button>
          <button
            onClick={() => { setEditingExam(null); setIsFormOpen(true); }}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-4 bg-medical-600 hover:bg-medical-700 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-medical-600/20 active:scale-95 transition-all"
          >
            <Plus size={18} /> Schedule
          </button>
        </div>
      </div>

      {/* Dashboard Section */}
      <ExamDashboard exams={exams} />

      {/* View Switcher */}
      <div className="flex items-center justify-between">
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl">
          <button
            onClick={() => setView('list')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-medical-600' : 'text-slate-500'}`}
          >
            <List size={16} /> List
          </button>
          <button
            onClick={() => setView('calendar')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'calendar' ? 'bg-white dark:bg-slate-700 shadow-sm text-medical-600' : 'text-slate-500'}`}
          >
            <CalendarIcon size={16} /> Calendar
          </button>
        </div>

        <button
          onClick={() => setToast({ message: "Alert sent to emergency contacts!", type: 'info' })}
          className="flex items-center gap-2 px-4 py-2 text-red-500 font-black text-[10px] uppercase tracking-widest hover:bg-red-50 dark:hover:bg-red-900/10 rounded-xl transition-all active:scale-95"
        >
          <Clock size={14} className="animate-pulse" /> I'm running late
        </button>
      </div>

      {/* Content Area */}
      <div ref={timetableRef}>
        {view === 'list' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <AnimatePresence mode="popLayout">
              {sortedExams.length > 0 ? sortedExams.map((exam) => (
                <ExamCard
                  key={exam.id}
                  exam={exam}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onUpdateReadiness={handleUpdateReadiness}
                  onToggleTopic={handleToggleTopic}
                />
              )) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="col-span-full py-20 flex flex-col items-center gap-4 text-slate-300"
                >
                  <CalendarIcon size={64} className="opacity-20" />
                  <p className="font-black uppercase tracking-widest text-lg">No Assessments Scheduled</p>
                  <button
                    onClick={() => setIsFormOpen(true)}
                    className="text-medical-600 font-bold hover:underline"
                  >
                    Add your first exam now
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-8 bg-white dark:bg-slate-800 p-8 rounded-[3rem] shadow-clinical border border-slate-50 dark:border-slate-700"
          >
            <div className="lg:col-span-2">
              <Calendar
                className="w-full border-none shadow-none bg-transparent"
                tileClassName={({ date, view }) => {
                  if (view === 'month') {
                    const hasExam = exams.find(e => isSameDay(parseISO(e.date), date));
                    if (hasExam) {
                      return 'bg-medical-100 dark:bg-medical-900/40 text-medical-600 dark:text-medical-400 font-black rounded-2xl border-2 border-medical-500/20';
                    }
                  }
                }}
              />
            </div>
            <div className="space-y-6">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                <Clock size={14} /> Schedule Preview
              </h4>
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {sortedExams.length > 0 ? sortedExams.map(exam => (
                  <div key={exam.id} className="p-4 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border-l-4 border-medical-500 group cursor-pointer hover:bg-white dark:hover:bg-slate-700 transition-all shadow-sm" onClick={() => handleEdit(exam)}>
                    <p className="font-black text-slate-800 dark:text-white text-sm group-hover:text-medical-600 transition-colors">{exam.title}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">{format(parseISO(exam.date), 'MMM dd')}</span>
                      <span className="w-1 h-1 rounded-full bg-slate-300" />
                      <span className="text-[10px] font-bold text-slate-400 uppercase">{exam.time}</span>
                    </div>
                  </div>
                )) : (
                  <p className="text-sm text-slate-400 italic">Clear schedule.</p>
                )}
              </div>
            </div>
          </motion.div>
        )}
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
