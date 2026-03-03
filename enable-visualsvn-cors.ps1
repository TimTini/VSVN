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
$resultFile = Join-Path $repoRoot "visualsvn-cors-result.txt"
$confPath = "C:\Program Files\VisualSVN Server\conf\httpd-custom.conf"

if (-not (Test-IsAdmin)) {
  $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Elevated"
  Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argList | Out-Null
  Write-Host "UAC prompt da hien thi. Hay chon Yes de bat CORS."
  exit 0
}

try {
  if (-not (Test-Path $confPath)) {
    throw "Khong tim thay file config: $confPath"
  }

  $existing = Get-Content -LiteralPath $confPath -Raw
  if ($null -eq $existing) { $existing = "" }
  $beginMarker = "# BEGIN CODEX SVN CORS"
  $endMarker = "# END CODEX SVN CORS"

  $pattern = [regex]::Escape($beginMarker) + ".*?" + [regex]::Escape($endMarker)
  $cleaned = [regex]::Replace([string]$existing, $pattern, "", [System.Text.RegularExpressions.RegexOptions]::Singleline).TrimEnd()

$corsBlock = @"
# BEGIN CODEX SVN CORS
RewriteEngine On
RewriteCond %{REQUEST_METHOD} =OPTIONS
RewriteRule "^/svn/.*$" "-" [R=204,L]

<Location "/svn/">
  Header always set Access-Control-Allow-Origin "*"
  Header always set Access-Control-Allow-Methods "GET, OPTIONS, PROPFIND, REPORT, MKACTIVITY, CHECKOUT, MERGE, PROPPATCH, MKCOL, DELETE, COPY, MOVE, PUT, POST"
  Header always set Access-Control-Allow-Headers "Authorization, Content-Type, Depth, X-Requested-With"
  Header always set Access-Control-Max-Age "86400"
</Location>
# END CODEX SVN CORS
"@

  $newContent = ($cleaned + "`r`n`r`n" + $corsBlock).Trim() + "`r`n"
  Set-Content -LiteralPath $confPath -Value $newContent -Encoding UTF8

  Restart-Service -Name VisualSVNServer -Force
  Start-Sleep -Seconds 2

  $opt = & curl.exe -k -i -X OPTIONS -H "Origin: file://" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: authorization" "https://127.0.0.1/svn/demo-repo/" 2>&1
  $head = & curl.exe -k -I -H "Origin: file://" -u "svntest:SvnTest@123" "https://127.0.0.1/svn/demo-repo/" 2>&1

  $report = @(
    "STATUS=OK",
    "DATE_UTC=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))",
    "--- OPTIONS ---",
    ($opt -join "`r`n"),
    "--- HEAD ---",
    ($head -join "`r`n")
  ) -join "`r`n"

  Set-Content -LiteralPath $resultFile -Value $report -Encoding UTF8
  Write-Host "Da bat CORS. Kiem tra file: $resultFile"
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
