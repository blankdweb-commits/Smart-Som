with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

bad_line = '          <div className={}><Brain size={40} className="animate-pulse" /></div>'
good_line = '          <div className={`w-20 h-20 bg-slate-900 rounded-[2rem] flex items-center justify-center text-medical-400 mx-auto mb-6 ${isLowPowerMode ? "" : "shadow-2xl"} border-2 border-medical-500/20`}><Brain size={40} className="animate-pulse" /></div>'

if bad_line in content:
    with open('src/pages/Quiz.jsx', 'w') as f:
        f.write(content.replace(bad_line, good_line))
    print('Fixed.')
else:
    print('Not found.')
