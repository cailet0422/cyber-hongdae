// 업데이트 설치 진행 창
// 설치 중에는 프로그램이 꺼져 있어 화면에 아무것도 없으므로, 윈도우 기본 PowerShell로 작은 창을 따로 띄운다.
// - 설치 프로그램(CyberHongdae-Setup-x.y.z) 프로세스가 끝나고 설치된 exe의 버전이 새 버전으로 바뀌면 "완료"로 표시
// - restart: 설치 후 새 버전이 실행되며 완료 표시 파일(flag)을 만들면 창을 닫음
// - quit: 프로그램을 닫을 때 설치한 경우. 완료되면 [프로그램 열기] 버튼을 보여 줌
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

function buildScript({ version, mode, installerName, exePath, flagFile, title }) {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$ver = ${q(version)}; $mode = ${q(mode)}; $proc = ${q(installerName)}; $exe = ${q(exePath)}; $flag = ${q(flagFile)}; $appTitle = ${q(title)}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
# 숨김 창 옵션으로 시작되면 첫 번째 창 표시가 숨김으로 처리되므로 보이지 않는 창으로 한 번 소모한다
$dummy = New-Object Windows.Forms.Form; $dummy.ShowInTaskbar = $false; $dummy.Opacity = 0; $dummy.Show(); $dummy.Close()

$dim = [Drawing.Color]::FromArgb(154, 154, 174)
$green = [Drawing.Color]::FromArgb(46, 204, 113)
$f = New-Object Windows.Forms.Form
$f.Text = "$appTitle 업데이트"
$f.ClientSize = New-Object Drawing.Size(420, 172)
$f.StartPosition = 'CenterScreen'; $f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false
$f.TopMost = $true; $f.BackColor = [Drawing.Color]::FromArgb(24, 24, 34); $f.ForeColor = [Drawing.Color]::White
$f.Font = New-Object Drawing.Font('Malgun Gothic', 10)
$ico = [Drawing.Icon]::ExtractAssociatedIcon($exe); if ($ico) { $f.Icon = $ico }
$head = New-Object Windows.Forms.Label; $head.Location = '20,16'; $head.Size = '380,28'
$head.Font = New-Object Drawing.Font('Malgun Gothic', 12, [Drawing.FontStyle]::Bold)
$head.Text = "v$ver 업데이트 설치 중"
$msg = New-Object Windows.Forms.Label; $msg.Location = '20,48'; $msg.Size = '380,22'; $msg.ForeColor = $dim
if ($mode -eq 'restart') { $msg.Text = '설치가 끝나면 프로그램이 자동으로 다시 열립니다.' } else { $msg.Text = '설치가 끝날 때까지 잠시 기다려 주세요.' }
$bar = New-Object Windows.Forms.ProgressBar; $bar.Location = '20,80'; $bar.Size = '380,16'; $bar.Style = 'Marquee'; $bar.MarqueeAnimationSpeed = 25
$time = New-Object Windows.Forms.Label; $time.Location = '20,102'; $time.Size = '380,20'; $time.ForeColor = $dim
$open = New-Object Windows.Forms.Button; $open.Text = '프로그램 열기'; $open.Location = '186,130'; $open.Size = '120,30'; $open.Visible = $false; $open.FlatStyle = 'System'
$close = New-Object Windows.Forms.Button; $close.Text = '닫기'; $close.Location = '312,130'; $close.Size = '88,30'; $close.Visible = $false; $close.FlatStyle = 'System'
# 키보드 포커스를 받지 않게 해서 다른 곳에 치던 Enter·Space로 눌리지 않도록 함
$open.TabStop = $false; $close.TabStop = $false
$open.Add_Click({ Start-Process -FilePath $exe; $f.Close() })
$close.Add_Click({ $f.Close() })
$f.Controls.AddRange(@($head, $msg, $bar, $time, $open, $close))

Remove-Item -LiteralPath $flag -Force
$t0 = Get-Date
$st = @{ done = $false; doneAt = $null; stable = 0 }
function Finish([bool]$ok) {
  $st.done = $true; $st.doneAt = Get-Date
  $bar.Style = 'Continuous'; $bar.Value = 100; $time.Text = ''
  if ($ok) {
    $head.ForeColor = $green; $head.Text = "v$ver 업데이트 완료!"; $f.Text = "$appTitle 업데이트 완료"
    if ($mode -eq 'restart') { $msg.Text = '새 버전으로 프로그램을 여는 중입니다…' }
    else { $msg.Text = '이제 프로그램을 열면 새 버전으로 실행됩니다.'; $open.Visible = $true; $close.Visible = $true; $f.ActiveControl = $null }
  } else {
    $head.Text = '업데이트 상태를 확인하지 못했습니다'
    $msg.Text = '프로그램을 직접 열어 설정 탭에서 버전을 확인해 주세요.'; $open.Visible = $true; $close.Visible = $true; $f.ActiveControl = $null
  }
}
$timer = New-Object Windows.Forms.Timer; $timer.Interval = 500
$timer.Add_Tick({
  $now = Get-Date
  if ($st.done) {
    $after = ($now - $st.doneAt).TotalSeconds
    if ($mode -eq 'restart' -and ((Test-Path -LiteralPath $flag) -or $after -gt 20)) { $f.Close() }
    elseif ($after -gt 180) { $f.Close() }
    return
  }
  $el = [int]($now - $t0).TotalSeconds
  $running = $null -ne (Get-Process -Name $proc -ErrorAction SilentlyContinue)
  $fv = (Get-Item -LiteralPath $exe -ErrorAction SilentlyContinue).VersionInfo.FileVersion
  if ($fv -eq $ver -and -not $running) { $st.stable++ } else { $st.stable = 0 }
  $time.Text = "설치 중… \${el}초 경과"
  if ($st.stable -ge 3 -or (Test-Path -LiteralPath $flag)) { Finish $true }
  elseif ($el -gt 300) { Finish $false }
})
$f.Add_Shown({ $timer.Start() })
[void]$f.ShowDialog()
`;
}

function showUpdateSplash(opts) {
  if (process.platform !== 'win32') return false;
  try {
    // 스크립트는 임시 파일에 쓰고 짧은 로더만 명령줄로 넘긴다 (cmd 명령줄은 8191자 제한)
    const file = path.join(os.tmpdir(), 'cyberhongdae-update-splash.ps1');
    fs.writeFileSync(file, buildScript(opts), 'utf8');
    const loader = `. ([ScriptBlock]::Create([IO.File]::ReadAllText(${q(file)}, [Text.Encoding]::UTF8)))`;
    const b64 = Buffer.from(loader, 'utf16le').toString('base64');
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const exe = fs.existsSync(ps) ? ps : 'powershell.exe';
    // detached로 띄우면 콘솔이 없어 PowerShell이 바로 종료되므로 cmd의 start /b로 띄운다.
    // cmd가 띄운 손자 프로세스는 Electron(libuv) 작업 개체에서 빠져나가므로 프로그램이 꺼져도 창이 남는다.
    const cmd = `"start "" /b "${exe}" -NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -EncodedCommand ${b64}"`;
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmd], { stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
    return true;
  } catch {
    return false;
  }
}

module.exports = { showUpdateSplash, buildScript };
