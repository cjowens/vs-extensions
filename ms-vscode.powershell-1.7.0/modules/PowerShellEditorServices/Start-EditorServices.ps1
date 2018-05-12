# PowerShell Editor Services Bootstrapper Script
# ----------------------------------------------
# This script contains startup logic for the PowerShell Editor Services
# module when launched by an editor.  It handles the following tasks:
#
# - Verifying the existence of dependencies like PowerShellGet
# - Verifying that the expected version of the PowerShellEditorServices module is installed
# - Installing the PowerShellEditorServices module if confirmed by the user
# - Finding unused TCP port numbers for the language and debug services to use
# - Starting the language and debug services from the PowerShellEditorServices module
#
# NOTE: If editor integration authors make modifications to this
#       script, please consider contributing changes back to the
#       canonical version of this script at the PowerShell Editor
#       Services GitHub repository:
#
#       https://github.com/PowerShell/PowerShellEditorServices/blob/master/module/PowerShellEditorServices/Start-EditorServices.ps1

param(
    [Parameter(Mandatory=$true)]
    [ValidateNotNullOrEmpty()]
    [string]
    $HostName,

    [Parameter(Mandatory=$true)]
    [ValidateNotNullOrEmpty()]
    [string]
    $HostProfileId,

    [Parameter(Mandatory=$true)]
    [ValidateNotNullOrEmpty()]
    [string]
    $HostVersion,

    [ValidateNotNullOrEmpty()]
    [string]
    $BundledModulesPath,

    [ValidateNotNullOrEmpty()]
    $LogPath,

    [ValidateSet("Diagnostic", "Normal", "Verbose", "Error", "Diagnostic")]
    $LogLevel,

	[Parameter(Mandatory=$true)]
	[ValidateNotNullOrEmpty()]
	[string]
	$SessionDetailsPath,

    [switch]
    $EnableConsoleRepl,

    [switch]
    $DebugServiceOnly,

    [string[]]
    $AdditionalModules,

    [string[]]
    $FeatureFlags,

    [switch]
    $WaitForDebugger,

    [switch]
    $ConfirmInstall,

    [switch]
    $Stdio,

    [string]
    $LanguageServicePipeName = $null,

    [string]
    $DebugServicePipeName = $null
)

$minPortNumber = 10000
$maxPortNumber = 30000

if ($LogLevel -eq "Diagnostic") {
    $VerbosePreference = 'Continue'
    Start-Transcript (Join-Path (Split-Path $LogPath -Parent) Start-EditorServices.log) -Force
}

function LogSection([string]$msg) {
    Write-Verbose "`n#-- $msg $('-' * ([Math]::Max(0, 73 - $msg.Length)))"
}

function Log([string[]]$msg) {
    $msg | Write-Verbose
}

function ExitWithError($errorString) {
    Write-Host -ForegroundColor Red "`n`n$errorString"

    # Sleep for a while to make sure the user has time to see and copy the
    # error message
    Start-Sleep -Seconds 300

    exit 1;
}

function WriteSessionFile($sessionInfo) {
    $sessionInfoJson = ConvertTo-Json -InputObject $sessionInfo -Compress
    Log "Writing session file with contents:"
    Log $sessionInfoJson
    $sessionInfoJson | Set-Content -Force -Path "$SessionDetailsPath" -ErrorAction Stop
}

# Are we running in PowerShell 2 or earlier?
if ($PSVersionTable.PSVersion.Major -le 2) {
    # No ConvertTo-Json on PSv2 and below, so write out the JSON manually
    "{`"status`": `"failed`", `"reason`": `"unsupported`", `"powerShellVersion`": `"$($PSVersionTable.PSVersion.ToString())`"}" |
        Set-Content -Force -Path "$SessionDetailsPath" -ErrorAction Stop

    ExitWithError "Unsupported PowerShell version $($PSVersionTable.PSVersion), language features are disabled."
}


if ($host.Runspace.LanguageMode -eq 'ConstrainedLanguage') {
    WriteSessionFile @{
        "status" = "failed"
        "reason" = "languageMode"
        "detail" = $host.Runspace.LanguageMode.ToString()
    }

    ExitWithError "PowerShell is configured with an unsupported LanguageMode (ConstrainedLanguage), language features are disabled."
}

# Are we running in PowerShell 5 or later?
$isPS5orLater = $PSVersionTable.PSVersion.Major -ge 5

# If PSReadline is present in the session, remove it so that runspace
# management is easier
if ((Get-Module PSReadline).Count -gt 0) {
    LogSection "Removing PSReadLine module"
    Remove-Module PSReadline -ErrorAction SilentlyContinue
}

# This variable will be assigned later to contain information about
# what happened while attempting to launch the PowerShell Editor
# Services host
$resultDetails = $null;

function Test-ModuleAvailable($ModuleName, $ModuleVersion) {
    Log "Testing module availability $ModuleName $ModuleVersion"

    $modules = Get-Module -ListAvailable $moduleName
    if ($modules -ne $null) {
        if ($ModuleVersion -ne $null) {
            foreach ($module in $modules) {
                if ($module.Version.Equals($moduleVersion)) {
                    Log "$ModuleName $ModuleVersion found"
                    return $true;
                }
            }
        }
        else {
            Log "$ModuleName $ModuleVersion found"
            return $true;
        }
    }

    Log "$ModuleName $ModuleVersion NOT found"
    return $false;
}

function Test-PortAvailability {
    param(
        [Parameter(Mandatory=$true)]
        [int]
        $PortNumber
    )

    $portAvailable = $true

    try {
        # After some research, I don't believe we should run into problems using an IPv4 port
        # that happens to be in use via an IPv6 address.  That is based on this info:
        # https://www.ibm.com/support/knowledgecenter/ssw_i5_54/rzai2/rzai2compipv4ipv6.htm#rzai2compipv4ipv6__compports
        $ipAddress = [System.Net.IPAddress]::Loopback
        Log "Testing availability of port ${PortNumber} at address ${ipAddress} / $($ipAddress.AddressFamily)"

        $tcpListener = New-Object System.Net.Sockets.TcpListener @($ipAddress, $PortNumber)
        $tcpListener.Start()
        $tcpListener.Stop()
    }
    catch [System.Net.Sockets.SocketException] {
        $portAvailable = $false

        # Check the SocketErrorCode to see if it's the expected exception
        if ($_.Exception.SocketErrorCode -eq [System.Net.Sockets.SocketError]::AddressAlreadyInUse) {
            Log "Port $PortNumber is in use."
        }
        else {
            Log "SocketException on port ${PortNumber}: $($_.Exception)"
        }
    }

    $portAvailable
}

$portsInUse = @{}
$rand = New-Object System.Random
function Get-AvailablePort() {
    $triesRemaining = 10;

    while ($triesRemaining -gt 0) {
        do {
            $port = $rand.Next($minPortNumber, $maxPortNumber)
        }
        while ($portsInUse.ContainsKey($port))

        # Whether we succeed or fail, don't try this port again
        $portsInUse[$port] = 1

        Log "Checking port: $port, attempts remaining $triesRemaining --------------------"
        if ((Test-PortAvailability -PortNumber $port) -eq $true) {
            Log "Port: $port is available"
            return $port
        }

        Log "Port: $port is NOT available"
        $triesRemaining--;
    }

    Log "Did not find any available ports!!"
    return $null
}

# Add BundledModulesPath to $env:PSModulePath
if ($BundledModulesPath) {
    $env:PSModulePath = $env:PSModulePath.TrimEnd([System.IO.Path]::PathSeparator) + [System.IO.Path]::PathSeparator + $BundledModulesPath
    LogSection "Updated PSModulePath to:"
    Log ($env:PSModulePath -split [System.IO.Path]::PathSeparator)
}

LogSection "Check required modules available"
# Check if PowerShellGet module is available
if ((Test-ModuleAvailable "PowerShellGet") -eq $false) {
    Log "Failed to find PowerShellGet module"
    # TODO: WRITE ERROR
}

try {
    LogSection "Start up PowerShellEditorServices"
    Log "Importing PowerShellEditorServices"

    Import-Module PowerShellEditorServices -ErrorAction Stop

	# Locate available port numbers for services
	# There could be only one service on Stdio channel

	$languageServiceTransport = $null
	$debugServiceTransport = $null

	if ($Stdio.IsPresent -and -not $DebugServiceOnly.IsPresent) { $languageServiceTransport = "Stdio" }
	elseif ($LanguageServicePipeName)                           { $languageServiceTransport = "NamedPipe"; $languageServicePipeName = "$LanguageServicePipeName" }
	elseif ($languageServicePort = Get-AvailablePort)           { $languageServiceTransport = "Tcp" }
	else                                                        { ExitWithError "Failed to find an open socket port for language service." }

	if ($Stdio.IsPresent -and $DebugServiceOnly.IsPresent)      { $debugServiceTransport = "Stdio" }
	elseif ($DebugServicePipeName)                              { $debugServiceTransport = "NamedPipe"; $debugServicePipeName = "$DebugServicePipeName" }
	elseif ($debugServicePort = Get-AvailablePort)              { $debugServiceTransport = "Tcp" }
	else                                                        { ExitWithError "Failed to find an open socket port for debug service." }

    if ($EnableConsoleRepl) {
        Write-Host "PowerShell Integrated Console`n"
    }

    # Create the Editor Services host
    Log "Invoking Start-EditorServicesHost"
    $editorServicesHost =
        Start-EditorServicesHost `
            -HostName $HostName `
            -HostProfileId $HostProfileId `
            -HostVersion $HostVersion `
            -LogPath $LogPath `
            -LogLevel $LogLevel `
            -AdditionalModules $AdditionalModules `
            -LanguageServicePort $languageServicePort `
            -DebugServicePort $debugServicePort `
            -LanguageServiceNamedPipe $LanguageServicePipeName `
            -DebugServiceNamedPipe $DebugServicePipeName `
            -Stdio:$Stdio.IsPresent`
            -BundledModulesPath $BundledModulesPath `
            -EnableConsoleRepl:$EnableConsoleRepl.IsPresent `
            -DebugServiceOnly:$DebugServiceOnly.IsPresent `
            -WaitForDebugger:$WaitForDebugger.IsPresent

    # TODO: Verify that the service is started
    Log "Start-EditorServicesHost returned $editorServicesHost"

    $resultDetails = @{
        "status" = "started";
        "languageServiceTransport" = $languageServiceTransport;
        "debugServiceTransport" = $debugServiceTransport;
    };

    if ($languageServicePipeName) { $resultDetails["languageServicePipeName"] = "$languageServicePipeName" }
    if ($debugServicePipeName)    { $resultDetails["debugServicePipeName"]    = "$debugServicePipeName" }

    if ($languageServicePort)     { $resultDetails["languageServicePort"]     = $languageServicePort }
    if ($debugServicePort)        { $resultDetails["debugServicePort"]        = $debugServicePort }

    # Notify the client that the services have started
    WriteSessionFile $resultDetails

    Log "Wrote out session file"
}
catch [System.Exception] {
    $e = $_.Exception;
    $errorString = ""

    Log "ERRORS caught starting up EditorServicesHost"

    while ($e -ne $null) {
        $errorString = $errorString + ($e.Message + "`r`n" + $e.StackTrace + "`r`n")
        $e = $e.InnerException;
        Log $errorString
    }

    ExitWithError ("An error occurred while starting PowerShell Editor Services:`r`n`r`n" + $errorString)
}

try {
    # Wait for the host to complete execution before exiting
    LogSection "Waiting for EditorServicesHost to complete execution"
    $editorServicesHost.WaitForCompletion()
    Log "EditorServicesHost has completed execution"
}
catch [System.Exception] {
    $e = $_.Exception;
    $errorString = ""

    Log "ERRORS caught while waiting for EditorServicesHost to complete execution"

    while ($e -ne $null) {
        $errorString = $errorString + ($e.Message + "`r`n" + $e.StackTrace + "`r`n")
        $e = $e.InnerException;
        Log $errorString
    }
}

# SIG # Begin signature block
# MIIdhgYJKoZIhvcNAQcCoIIddzCCHXMCAQExCzAJBgUrDgMCGgUAMGkGCisGAQQB
# gjcCAQSgWzBZMDQGCisGAQQBgjcCAR4wJgIDAQAABBAfzDtgWUsITrck0sYpfvNR
# AgEAAgEAAgEAAgEAAgEAMCEwCQYFKw4DAhoFAAQU7kdEpcrts9KOEUnxzlAGN9DV
# T6GgghhUMIIEwjCCA6qgAwIBAgITMwAAAMDeLD0HlORJeQAAAAAAwDANBgkqhkiG
# 9w0BAQUFADB3MQswCQYDVQQGEwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4G
# A1UEBxMHUmVkbW9uZDEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMSEw
# HwYDVQQDExhNaWNyb3NvZnQgVGltZS1TdGFtcCBQQ0EwHhcNMTYwOTA3MTc1ODUw
# WhcNMTgwOTA3MTc1ODUwWjCBsjELMAkGA1UEBhMCVVMxEzARBgNVBAgTCldhc2hp
# bmd0b24xEDAOBgNVBAcTB1JlZG1vbmQxHjAcBgNVBAoTFU1pY3Jvc29mdCBDb3Jw
# b3JhdGlvbjEMMAoGA1UECxMDQU9DMScwJQYDVQQLEx5uQ2lwaGVyIERTRSBFU046
# N0FCNS0yREYyLURBM0YxJTAjBgNVBAMTHE1pY3Jvc29mdCBUaW1lLVN0YW1wIFNl
# cnZpY2UwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDoiKVSfklVAB4E
# Oc9+r95kl32muXNITYcTbaRtuJl+MQzEnD0eU2JUXx2mI06ONnTfFW39ZQPF1pvU
# WkHBrS6m8oKy7Em4Ol91RJ5Knwy1VvY2Tawqh+VxwdARRgOeFtFm0S+Pa+BrXtVU
# hTtGl0BGMsKGEQKdDNGJD259Iq47qPLw3CmllE3/YFw1GGoJ9C3ry+I7ntxIjJYB
# LXA122vw93OOD/zWFh1SVq2AejPxcjKtHH2hjoeTKwkFeMNtIekrUSvhbuCGxW5r
# 54KW0Yus4o8392l9Vz8lSEn2j/TgPTqD6EZlzkpw54VSwede/vyqgZIrRbat0bAh
# b8doY8vDAgMBAAGjggEJMIIBBTAdBgNVHQ4EFgQUFf5K2jOJ0xmF1WRZxNxTQRBP
# tzUwHwYDVR0jBBgwFoAUIzT42VJGcArtQPt2+7MrsMM1sw8wVAYDVR0fBE0wSzBJ
# oEegRYZDaHR0cDovL2NybC5taWNyb3NvZnQuY29tL3BraS9jcmwvcHJvZHVjdHMv
# TWljcm9zb2Z0VGltZVN0YW1wUENBLmNybDBYBggrBgEFBQcBAQRMMEowSAYIKwYB
# BQUHMAKGPGh0dHA6Ly93d3cubWljcm9zb2Z0LmNvbS9wa2kvY2VydHMvTWljcm9z
# b2Z0VGltZVN0YW1wUENBLmNydDATBgNVHSUEDDAKBggrBgEFBQcDCDANBgkqhkiG
# 9w0BAQUFAAOCAQEAGeJAuzJMR+kovMi8RK/LtfrKazWlR5Lx02hM9GFmMk1zWCSc
# pfVY6xqfzWFllCFHBtOaJZqLiV97jfNCLpG0PULz24CWSkG7jJ+mZaCSicZ7ZC3b
# WDh1zpc54llYVyyTkRVYx/mtc9GujqbS8CBZgjaT/JsECnvGAPUcLYuSGt53CU1b
# UuiNwuzAhai4glcYyq3/7qMmmAtbnbCZhR5ySoMy7BwdzN70drLtafCJQncfAHXV
# O5r6SX4U/2J2zvWhA8lqhZu9SRulFGRvf81VTf+k5rJ2TjL6dYtSchooJ5YVvUk6
# i7bfV0VBN8xpaUhk8jbBnxhDPKIvDvnZlhPuJjCCBgEwggPpoAMCAQICEzMAAADE
# 6Yn4eoFQ6f8AAAAAAMQwDQYJKoZIhvcNAQELBQAwfjELMAkGA1UEBhMCVVMxEzAR
# BgNVBAgTCldhc2hpbmd0b24xEDAOBgNVBAcTB1JlZG1vbmQxHjAcBgNVBAoTFU1p
# Y3Jvc29mdCBDb3Jwb3JhdGlvbjEoMCYGA1UEAxMfTWljcm9zb2Z0IENvZGUgU2ln
# bmluZyBQQ0EgMjAxMTAeFw0xNzA4MTEyMDIwMjRaFw0xODA4MTEyMDIwMjRaMHQx
# CzAJBgNVBAYTAlVTMRMwEQYDVQQIEwpXYXNoaW5ndG9uMRAwDgYDVQQHEwdSZWRt
# b25kMR4wHAYDVQQKExVNaWNyb3NvZnQgQ29ycG9yYXRpb24xHjAcBgNVBAMTFU1p
# Y3Jvc29mdCBDb3Jwb3JhdGlvbjCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoC
# ggEBAIiKuCTDB4+agHkV/CZg/HKILPr0o5eIlka3o8tfiS86My4ekXj6fKkfggG1
# essavAPKRuvFmff7BB3yhQr/Im6h8mc9xScY5Sgf9QSUQWPs47oVjO0TmjXeOHBU
# bzvsrUUJMEnBvo8wmQzLdsn3c5UWd9GLu5THCIUg7R6oNfFxwuB0AEuK0tyR69Z4
# /o36rWCIPb25H65il7/FhLGQrtavK9NU+zXazXGS5h7/7HFry38IdnTgEFFI1PEA
# yEhMowc15VkN/XycyOZa44X11poPH46m5IQXwdbKnx0Bx/1IpxOSM5chSDL4wiSi
# ALK+U8qDbilbge84boDzu+wTC+sCAwEAAaOCAYAwggF8MB8GA1UdJQQYMBYGCisG
# AQQBgjdMCAEGCCsGAQUFBwMDMB0GA1UdDgQWBBTL1mKEz2A56v9nwlzSyLurt8MT
# mDBSBgNVHREESzBJpEcwRTENMAsGA1UECxMETU9QUjE0MDIGA1UEBRMrMjMwMDEy
# K2M4MDRiNWVhLTQ5YjQtNDIzOC04MzYyLWQ4NTFmYTIyNTRmYzAfBgNVHSMEGDAW
# gBRIbmTlUAXTgqoXNzcitW2oynUClTBUBgNVHR8ETTBLMEmgR6BFhkNodHRwOi8v
# d3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL2NybC9NaWNDb2RTaWdQQ0EyMDExXzIw
# MTEtMDctMDguY3JsMGEGCCsGAQUFBwEBBFUwUzBRBggrBgEFBQcwAoZFaHR0cDov
# L3d3dy5taWNyb3NvZnQuY29tL3BraW9wcy9jZXJ0cy9NaWNDb2RTaWdQQ0EyMDEx
# XzIwMTEtMDctMDguY3J0MAwGA1UdEwEB/wQCMAAwDQYJKoZIhvcNAQELBQADggIB
# AAYWH9tXwlDII0+iUXjX7fj9zb3VwPH5G1btU8hpRwXVxMvs4vyZW5VfETgowAVF
# E+CaeYi8Zqvbu+sCVSO3PSN4QW2u+PEAWpSZihzMCZXQmhxEMKmlFse6R1v1KzSL
# n49YN8NOHK8iyhDN2IIQqTXwriLIjySmgYvfJxzkZh2JPi7/VwNNwW6DoDLrtLMv
# UFZdBrEVjMgdY7dzDOPWeiYPKpZFpzKDPpY+V0l3I4n+sRDHiuUIFVHFK1oxWzlq
# lqikiGuWKG/xxK7qvUUXzGJOgbVUGkeOmKVtwG4nxvgnH8jtIKkLsfHOC5qU4mqd
# aYOhNtdtIP6F1f/DuJc2Cf49FMGYFKnAhszvgsGrVSRDGLVIhXiG0PnSnT8Z2RSJ
# 542faCSIaDupx4BOJucIIUxj/ZyTFU0ztVZgT9dKuTiO/y7dsV+kQ2vJeM+xu2uP
# g2yHcqrqpfuf3RrWOfxkyW0+COV8g7GtvKO6e8+WVqR6WMsSR2LSIe/8PMQxC/cv
# PmSlN29gUD+3RJBPoAuLvn5Y9sdnh2HbnpjEyIzLb0fhwC6U7bH2sDBt7GpJqOmW
# dsi9CMT+O/WuczcGslbPGdS79ZTKhxzygGoBT7YbgXOz01siPzpYGN+I7mfESacv
# 3CWLPV7Q7DREkR28kQx2gj7vxNgtoQQCjkj5790CzwOiMIIGBzCCA++gAwIBAgIK
# YRZoNAAAAAAAHDANBgkqhkiG9w0BAQUFADBfMRMwEQYKCZImiZPyLGQBGRYDY29t
# MRkwFwYKCZImiZPyLGQBGRYJbWljcm9zb2Z0MS0wKwYDVQQDEyRNaWNyb3NvZnQg
# Um9vdCBDZXJ0aWZpY2F0ZSBBdXRob3JpdHkwHhcNMDcwNDAzMTI1MzA5WhcNMjEw
# NDAzMTMwMzA5WjB3MQswCQYDVQQGEwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQ
# MA4GA1UEBxMHUmVkbW9uZDEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9u
# MSEwHwYDVQQDExhNaWNyb3NvZnQgVGltZS1TdGFtcCBQQ0EwggEiMA0GCSqGSIb3
# DQEBAQUAA4IBDwAwggEKAoIBAQCfoWyx39tIkip8ay4Z4b3i48WZUSNQrc7dGE4k
# D+7Rp9FMrXQwIBHrB9VUlRVJlBtCkq6YXDAm2gBr6Hu97IkHD/cOBJjwicwfyzMk
# h53y9GccLPx754gd6udOo6HBI1PKjfpFzwnQXq/QsEIEovmmbJNn1yjcRlOwhtDl
# KEYuJ6yGT1VSDOQDLPtqkJAwbofzWTCd+n7Wl7PoIZd++NIT8wi3U21StEWQn0gA
# SkdmEScpZqiX5NMGgUqi+YSnEUcUCYKfhO1VeP4Bmh1QCIUAEDBG7bfeI0a7xC1U
# n68eeEExd8yb3zuDk6FhArUdDbH895uyAc4iS1T/+QXDwiALAgMBAAGjggGrMIIB
# pzAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBQjNPjZUkZwCu1A+3b7syuwwzWz
# DzALBgNVHQ8EBAMCAYYwEAYJKwYBBAGCNxUBBAMCAQAwgZgGA1UdIwSBkDCBjYAU
# DqyCYEBWJ5flJRP8KuEKU5VZ5KShY6RhMF8xEzARBgoJkiaJk/IsZAEZFgNjb20x
# GTAXBgoJkiaJk/IsZAEZFgltaWNyb3NvZnQxLTArBgNVBAMTJE1pY3Jvc29mdCBS
# b290IENlcnRpZmljYXRlIEF1dGhvcml0eYIQea0WoUqgpa1Mc1j0BxMuZTBQBgNV
# HR8ESTBHMEWgQ6BBhj9odHRwOi8vY3JsLm1pY3Jvc29mdC5jb20vcGtpL2NybC9w
# cm9kdWN0cy9taWNyb3NvZnRyb290Y2VydC5jcmwwVAYIKwYBBQUHAQEESDBGMEQG
# CCsGAQUFBzAChjhodHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpL2NlcnRzL01p
# Y3Jvc29mdFJvb3RDZXJ0LmNydDATBgNVHSUEDDAKBggrBgEFBQcDCDANBgkqhkiG
# 9w0BAQUFAAOCAgEAEJeKw1wDRDbd6bStd9vOeVFNAbEudHFbbQwTq86+e4+4LtQS
# ooxtYrhXAstOIBNQmd16QOJXu69YmhzhHQGGrLt48ovQ7DsB7uK+jwoFyI1I4vBT
# Fd1Pq5Lk541q1YDB5pTyBi+FA+mRKiQicPv2/OR4mS4N9wficLwYTp2Oawpylbih
# OZxnLcVRDupiXD8WmIsgP+IHGjL5zDFKdjE9K3ILyOpwPf+FChPfwgphjvDXuBfr
# Tot/xTUrXqO/67x9C0J71FNyIe4wyrt4ZVxbARcKFA7S2hSY9Ty5ZlizLS/n+YWG
# zFFW6J1wlGysOUzU9nm/qhh6YinvopspNAZ3GmLJPR5tH4LwC8csu89Ds+X57H21
# 46SodDW4TsVxIxImdgs8UoxxWkZDFLyzs7BNZ8ifQv+AeSGAnhUwZuhCEl4ayJ4i
# IdBD6Svpu/RIzCzU2DKATCYqSCRfWupW76bemZ3KOm+9gSd0BhHudiG/m4LBJ1S2
# sWo9iaF2YbRuoROmv6pH8BJv/YoybLL+31HIjCPJZr2dHYcSZAI9La9Zj7jkIeW1
# sMpjtHhUBdRBLlCslLCleKuzoJZ1GtmShxN1Ii8yqAhuoFuMJb+g74TKIdbrHk/J
# mu5J4PcBZW+JC33Iacjmbuqnl84xKf8OxVtc2E0bodj6L54/LlUWa8kTo/0wggd6
# MIIFYqADAgECAgphDpDSAAAAAAADMA0GCSqGSIb3DQEBCwUAMIGIMQswCQYDVQQG
# EwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9uZDEeMBwG
# A1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMTIwMAYDVQQDEylNaWNyb3NvZnQg
# Um9vdCBDZXJ0aWZpY2F0ZSBBdXRob3JpdHkgMjAxMTAeFw0xMTA3MDgyMDU5MDla
# Fw0yNjA3MDgyMTA5MDlaMH4xCzAJBgNVBAYTAlVTMRMwEQYDVQQIEwpXYXNoaW5n
# dG9uMRAwDgYDVQQHEwdSZWRtb25kMR4wHAYDVQQKExVNaWNyb3NvZnQgQ29ycG9y
# YXRpb24xKDAmBgNVBAMTH01pY3Jvc29mdCBDb2RlIFNpZ25pbmcgUENBIDIwMTEw
# ggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQCr8PpyEBwurdhuqoIQTTS6
# 8rZYIZ9CGypr6VpQqrgGOBoESbp/wwwe3TdrxhLYC/A4wpkGsMg51QEUMULTiQ15
# ZId+lGAkbK+eSZzpaF7S35tTsgosw6/ZqSuuegmv15ZZymAaBelmdugyUiYSL+er
# CFDPs0S3XdjELgN1q2jzy23zOlyhFvRGuuA4ZKxuZDV4pqBjDy3TQJP4494HDdVc
# eaVJKecNvqATd76UPe/74ytaEB9NViiienLgEjq3SV7Y7e1DkYPZe7J7hhvZPrGM
# XeiJT4Qa8qEvWeSQOy2uM1jFtz7+MtOzAz2xsq+SOH7SnYAs9U5WkSE1JcM5bmR/
# U7qcD60ZI4TL9LoDho33X/DQUr+MlIe8wCF0JV8YKLbMJyg4JZg5SjbPfLGSrhwj
# p6lm7GEfauEoSZ1fiOIlXdMhSz5SxLVXPyQD8NF6Wy/VI+NwXQ9RRnez+ADhvKwC
# gl/bwBWzvRvUVUvnOaEP6SNJvBi4RHxF5MHDcnrgcuck379GmcXvwhxX24ON7E1J
# MKerjt/sW5+v/N2wZuLBl4F77dbtS+dJKacTKKanfWeA5opieF+yL4TXV5xcv3co
# KPHtbcMojyyPQDdPweGFRInECUzF1KVDL3SV9274eCBYLBNdYJWaPk8zhNqwiBfe
# nk70lrC8RqBsmNLg1oiMCwIDAQABo4IB7TCCAekwEAYJKwYBBAGCNxUBBAMCAQAw
# HQYDVR0OBBYEFEhuZOVQBdOCqhc3NyK1bajKdQKVMBkGCSsGAQQBgjcUAgQMHgoA
# UwB1AGIAQwBBMAsGA1UdDwQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB8GA1UdIwQY
# MBaAFHItOgIxkEO5FAVO4eqnxzHRI4k0MFoGA1UdHwRTMFEwT6BNoEuGSWh0dHA6
# Ly9jcmwubWljcm9zb2Z0LmNvbS9wa2kvY3JsL3Byb2R1Y3RzL01pY1Jvb0NlckF1
# dDIwMTFfMjAxMV8wM18yMi5jcmwwXgYIKwYBBQUHAQEEUjBQME4GCCsGAQUFBzAC
# hkJodHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpL2NlcnRzL01pY1Jvb0NlckF1
# dDIwMTFfMjAxMV8wM18yMi5jcnQwgZ8GA1UdIASBlzCBlDCBkQYJKwYBBAGCNy4D
# MIGDMD8GCCsGAQUFBwIBFjNodHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpb3Bz
# L2RvY3MvcHJpbWFyeWNwcy5odG0wQAYIKwYBBQUHAgIwNB4yIB0ATABlAGcAYQBs
# AF8AcABvAGwAaQBjAHkAXwBzAHQAYQB0AGUAbQBlAG4AdAAuIB0wDQYJKoZIhvcN
# AQELBQADggIBAGfyhqWY4FR5Gi7T2HRnIpsLlhHhY5KZQpZ90nkMkMFlXy4sPvjD
# ctFtg/6+P+gKyju/R6mj82nbY78iNaWXXWWEkH2LRlBV2AySfNIaSxzzPEKLUtCw
# /WvjPgcuKZvmPRul1LUdd5Q54ulkyUQ9eHoj8xN9ppB0g430yyYCRirCihC7pKkF
# DJvtaPpoLpWgKj8qa1hJYx8JaW5amJbkg/TAj/NGK978O9C9Ne9uJa7lryft0N3z
# Dq+ZKJeYTQ49C/IIidYfwzIY4vDFLc5bnrRJOQrGCsLGra7lstnbFYhRRVg4MnEn
# Gn+x9Cf43iw6IGmYslmJaG5vp7d0w0AFBqYBKig+gj8TTWYLwLNN9eGPfxxvFX1F
# p3blQCplo8NdUmKGwx1jNpeG39rz+PIWoZon4c2ll9DuXWNB41sHnIc+BncG0Qax
# dR8UvmFhtfDcxhsEvt9Bxw4o7t5lL+yX9qFcltgA1qFGvVnzl6UJS0gQmYAf0AAp
# xbGbpT9Fdx41xtKiop96eiL6SJUfq/tHI4D1nvi/a7dLl+LrdXga7Oo3mXkYS//W
# syNodeav+vyL6wuA6mk7r/ww7QRMjt/fdW1jkT3RnVZOT7+AVyKheBEyIXrvQQqx
# P/uozKRdwaGIm1dxVk5IRcBCyZt2WwqASGv9eZ/BvW1taslScxMNelDNMYIEnDCC
# BJgCAQEwgZUwfjELMAkGA1UEBhMCVVMxEzARBgNVBAgTCldhc2hpbmd0b24xEDAO
# BgNVBAcTB1JlZG1vbmQxHjAcBgNVBAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlvbjEo
# MCYGA1UEAxMfTWljcm9zb2Z0IENvZGUgU2lnbmluZyBQQ0EgMjAxMQITMwAAAMTp
# ifh6gVDp/wAAAAAAxDAJBgUrDgMCGgUAoIGwMBkGCSqGSIb3DQEJAzEMBgorBgEE
# AYI3AgEEMBwGCisGAQQBgjcCAQsxDjAMBgorBgEEAYI3AgEVMCMGCSqGSIb3DQEJ
# BDEWBBRgWzBEjkRcDRQcrFvpHn/FOWLOtTBQBgorBgEEAYI3AgEMMUIwQKAWgBQA
# UABvAHcAZQByAFMAaABlAGwAbKEmgCRodHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20v
# UG93ZXJTaGVsbCAwDQYJKoZIhvcNAQEBBQAEggEAdDafiYphlDfqDvif6+qHWB8j
# VrRcHqrrnxPDFKUfqxQ+I0qqGrib77RB/QvUlNqaLLO+OGfu0KP2+LYzsQ4DLHX7
# 8oikBh3nzpD4HyH8s0YnmKDaL/qCATXqDiHA0HP+P3xQjBvW9IrU4nqVDbsxmRcX
# QxjXfEspQXRoHiCntnJKwgaVCvvfhHVk4hImrQBva0zati/t38AUgl4mSuDO3Pgy
# +v3k1EhOjoZLhwutL8kZ/yWPrJB3dpRJLfHFWisOhsnt02bupRFLCh2reihanIeb
# AEa6Hfxo+5w4+Jf+9qwvVYp+MTqSm2fYGhqR9M7BiMlaUFASd2ylnlgsAVEEjqGC
# AigwggIkBgkqhkiG9w0BCQYxggIVMIICEQIBATCBjjB3MQswCQYDVQQGEwJVUzET
# MBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9uZDEeMBwGA1UEChMV
# TWljcm9zb2Z0IENvcnBvcmF0aW9uMSEwHwYDVQQDExhNaWNyb3NvZnQgVGltZS1T
# dGFtcCBQQ0ECEzMAAADA3iw9B5TkSXkAAAAAAMAwCQYFKw4DAhoFAKBdMBgGCSqG
# SIb3DQEJAzELBgkqhkiG9w0BBwEwHAYJKoZIhvcNAQkFMQ8XDTE4MDQyNjE3Mjkw
# NlowIwYJKoZIhvcNAQkEMRYEFDjV3Ox21BzWpFQENI+gEaSV3HkyMA0GCSqGSIb3
# DQEBBQUABIIBAFai3oaGCmnw/Tspj+KrtTXdEA9E3L8JM0C/RMVirZHu3rs/PNXQ
# TRgKyy4bdeS4Q8U5GGyaVy88CUux8ILC8QgnUYYkQLLak0pN/5UGv+Qw1Lp9ix58
# alrrsQqWZ082vtKb24ShuEmHrqsb814oMi5lwTB1Nu6SCaR84Z+AdzWIepYqpPO9
# NH7Rkb4WAbuG/5LZDy9JPxnor6vYlIPVMQWFbzWCN4617r5neVHIxv+m1Ac+xsT7
# n0f0vQep6r55l7gYvTTdyeeNTzhCCUN2TeF0xkQDH6WG25cit7w+DoLxtPOeNIEt
# 6sOPisJOK+O6JYCmGRIC1LFoMiSDOGxuWgI=
# SIG # End signature block
