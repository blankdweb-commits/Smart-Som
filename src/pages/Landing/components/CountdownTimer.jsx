import React, { useState, useEffect } from 'react';

const CountdownTimer = () => {
  const [timeLeft, setTimeLeft] = useState({
    hours: 23,
    minutes: 59,
    seconds: 12
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        let { hours, minutes, seconds } = prev;

        if (seconds > 0) {
          seconds--;
        } else {
          if (minutes > 0) {
            minutes--;
            seconds = 59;
          } else {
            if (hours > 0) {
              hours--;
              minutes = 59;
              seconds = 59;
            } else {
              // Reset to 24h for demo purposes
              hours = 23;
              minutes = 59;
              seconds = 59;
            }
          }
        }

        return { hours, minutes, seconds };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const format = (num) => num.toString().padStart(2, '0');

  return (
    <div className="flex items-center justify-center gap-2 font-mono text-2xl font-black text-teal-400">
      <div className="bg-slate-800 px-3 py-2 rounded-lg border border-slate-700">{format(timeLeft.hours)}</div>
      <span>:</span>
      <div className="bg-slate-800 px-3 py-2 rounded-lg border border-slate-700">{format(timeLeft.minutes)}</div>
      <span>:</span>
      <div className="bg-slate-800 px-3 py-2 rounded-lg border border-slate-700">{format(timeLeft.seconds)}</div>
    </div>
  );
};

export default CountdownTimer;
