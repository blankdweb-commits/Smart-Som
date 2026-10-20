$wd = 'C:\Users\yvngt\OneDrive\Desktop\Apex-Scholars\Smart-Som'
# WMI-spawned processes escape the shell's job object and survive after this script exits
$api = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = 'node scripts\serve-api.mjs'
  CurrentDirectory = $wd
}
Write-Output ('API PID: ' + $api.ProcessId + ' ret=' + $api.ReturnValue)
$web = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = 'node node_modules\vite\bin\vite.js'
  CurrentDirectory = $wd
}
Write-Output ('VITE PID: ' + $web.ProcessId + ' ret=' + $web.ReturnValue)
