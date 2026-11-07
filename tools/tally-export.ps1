<#
  One-click TallyPrime exporter for Tally Viewer.

  Asks the running TallyPrime (port 9000) for every open company and writes
    <Company>-Master.xml   (all masters)
    <Company>-Daybook.xml  (all vouchers in the period)
  into a folder you can send to the phone.

  Usage:  tally-export.cmd                  (current financial year, Desktop\TallyViewer)
          tally-export.cmd 20230401 20240331 D:\exports
  Tally must be open with "TallyPrime acts as" = Both/Server (F1 > Settings > Connectivity).
#>
param(
  [string]$From = "",
  [string]$To = "",
  [string]$OutDir = "",
  [string]$TallyUrl = "http://localhost:9000/"
)
$ErrorActionPreference = "Stop"
if (-not $From) { $now = Get-Date; $fy = if ($now.Month -ge 4) { $now.Year } else { $now.Year - 1 }; $From = "{0}0401" -f $fy }
if (-not $To)   { $To = (Get-Date).ToString("yyyyMMdd") }
if (-not $OutDir) { $OutDir = Join-Path ([Environment]::GetFolderPath("Desktop")) "TallyViewer" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Send-Tally([string]$xml) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($xml)
  $resp = Invoke-WebRequest -Uri $TallyUrl -Method Post -Body $bytes -ContentType "text/xml; charset=utf-8" -TimeoutSec 900 -UseBasicParsing
  return $resp.Content
}
function Esc([string]$s) { return [System.Security.SecurityElement]::Escape($s) }

Write-Host "Asking Tally at $TallyUrl for open companies..."
$list = Send-Tally '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TVCompanies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="TVCompanies" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
$names = [regex]::Matches($list, '<COMPANY NAME="([^"]+)"') | ForEach-Object { [System.Net.WebUtility]::HtmlDecode($_.Groups[1].Value) } | Select-Object -Unique
if (-not $names) { Write-Host "Tally answered but no company is open. Open the company in TallyPrime and run again."; exit 1 }

foreach ($co in $names) {
  $safe = ($co -replace '[\\/:*?"<>|]', '_')
  Write-Host "[$co] masters..."
  $m = Send-Tally ('<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (Esc $co) + '</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><ACCOUNTTYPE>All Masters</ACCOUNTTYPE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>')
  [IO.File]::WriteAllText((Join-Path $OutDir "$safe-Master.xml"), $m, [System.Text.Encoding]::UTF8)
  Write-Host "[$co] vouchers $From to $To ..."
  $v = Send-Tally ('<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + (Esc $co) + '</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE TYPE="Date">' + $From + '</SVFROMDATE><SVTODATE TYPE="Date">' + $To + '</SVTODATE><EXPLODEFLAG>Yes</EXPLODEFLAG></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>')
  [IO.File]::WriteAllText((Join-Path $OutDir "$safe-Daybook.xml"), $v, [System.Text.Encoding]::UTF8)
}
Write-Host "Done. Files are in $OutDir - send them to the phone and import in Tally Viewer."
