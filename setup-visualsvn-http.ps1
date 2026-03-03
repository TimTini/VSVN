param(
  [switch]$Elevated
)

$ErrorActionPreference = "Stop"

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$repoRoot = "e:\Documents\MyGitProject\LinhTinh\VSVN"
$resultFile = Join-Path $repoRoot "visualsvn-setup-result.txt"

if (-not (Test-IsAdmin)) {
  $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Elevated"
  Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argList | Out-Null
  Write-Host "UAC prompt da hien thi. Hay chon Yes de tiep tuc."
  exit 0
}

try {
  Import-Module "C:\Program Files\VisualSVN Server\PowerShellModules\VisualSVN\VisualSVN.psd1"

  Set-SvnServerConfiguration -EnableBasicAuthentication $true -EnableIntegratedAuthentication $false

  $username = "svntest"
  $passwordPlain = "SvnTest@123"
  $securePassword = ConvertTo-SecureString $passwordPlain -AsPlainText -Force

  if (-not (Get-SvnLocalUser -Name $username -ErrorAction SilentlyContinue)) {
    New-SvnLocalUser -Name $username -Password $securePassword | Out-Null
  }

  $repoName = "demo-repo"
  if (-not (Get-SvnRepository -Name $repoName -ErrorAction SilentlyContinue)) {
    New-SvnRepository -Name $repoName | Out-Null
  }

  $existingRule = Get-SvnAccessRule -Repository $repoName -Path "/" -AccountName $username -ErrorAction SilentlyContinue
  if (-not $existingRule) {
    Add-SvnAccessRule -Repository $repoName -Path "/" -AccountName $username -Access ReadWrite -AuthorizationProfile SubversionLocal | Out-Null
  } else {
    Set-SvnAccessRule -Repository $repoName -Path "/" -AccountName $username -Access ReadWrite -AuthorizationProfile SubversionLocal | Out-Null
  }

  $seedPath = Join-Path $repoRoot "svn-local\seed"
  $svnExe = "C:\Program Files\VisualSVN Server\bin\svn.exe"

  if (Test-Path $seedPath) {
    $listOutput = & $svnExe list --non-interactive --trust-server-cert-failures=unknown-ca,cn-mismatch,expired,not-yet-valid,other --username $username --password $passwordPlain "https://127.0.0.1/svn/$repoName" 2>$null
    if (-not $listOutput) {
      & $svnExe import $seedPath "https://127.0.0.1/svn/$repoName" -m "Initial import via setup script" --non-interactive --trust-server-cert-failures=unknown-ca,cn-mismatch,expired,not-yet-valid,other --username $username --password $passwordPlain | Out-Null
    }
  }

  $xmlLines = & $svnExe list -R --xml --non-interactive --trust-server-cert-failures=unknown-ca,cn-mismatch,expired,not-yet-valid,other --username $username --password $passwordPlain "https://127.0.0.1/svn/$repoName"
  $xml = ($xmlLines -join "`r`n")

  $report = @(
    "STATUS=OK",
    "DATE_UTC=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))",
    "URL=https://127.0.0.1/svn/demo-repo",
    "USERNAME=svntest",
    "PASSWORD=SvnTest@123",
    "--- XML ---",
    $xml
  ) -join "`r`n"

  Set-Content -LiteralPath $resultFile -Value $report -Encoding UTF8
  Write-Host "Da cau hinh xong. Kiem tra file: $resultFile"
}
catch {
  $msg = @(
    "STATUS=ERROR",
    "DATE_UTC=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))",
    "ERROR=$($_.Exception.Message)"
  ) -join "`r`n"
  Set-Content -LiteralPath $resultFile -Value $msg -Encoding UTF8
  throw
}
