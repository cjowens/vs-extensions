﻿#
# Copyright (c) Microsoft. All rights reserved.
# Licensed under the MIT license. See LICENSE file in the project root for full license information.
#

<#
.EXTERNALHELP ..\PowerShellEditorServices.Commands-help.xml
#>
function Register-EditorCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [ValidateNotNullOrEmpty()]
        [string]$Name,

        [Parameter(Mandatory=$true)]
        [ValidateNotNullOrEmpty()]
        [string]$DisplayName,

        [Parameter(
            Mandatory=$true,
            ParameterSetName="Function")]
        [ValidateNotNullOrEmpty()]
        [string]$Function,

        [Parameter(
            Mandatory=$true,
            ParameterSetName="ScriptBlock")]
        [ValidateNotNullOrEmpty()]
        [ScriptBlock]$ScriptBlock,

        [switch]$SuppressOutput
    )

    Process
    {
        $commandArgs = @($Name, $DisplayName, $SuppressOutput.IsPresent)

        if ($ScriptBlock -ne $null)
        {
            Write-Verbose "Registering command '$Name' which executes a ScriptBlock"
            $commandArgs += $ScriptBlock
        }
        else
        {
            Write-Verbose "Registering command '$Name' which executes a function"
            $commandArgs += $Function
        }

        $editorCommand = New-Object Microsoft.PowerShell.EditorServices.Extensions.EditorCommand -ArgumentList $commandArgs
        if ($psEditor.RegisterCommand($editorCommand))
        {
            Write-Verbose "Registered new command '$Name'"
        }
        else
        {
            Write-Verbose "Updated existing command '$Name'"
        }
    }
}

<#
.EXTERNALHELP ..\PowerShellEditorServices.Commands-help.xml
#>
function Unregister-EditorCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [ValidateNotNullOrEmpty()]
        [string]$Name
    )

    Process
    {
        Write-Verbose "Unregistering command '$Name'"
        $psEditor.UnregisterCommand($Name);
    }
}

<#
.SYNOPSIS
    Creates new files and opens them in your editor window
.DESCRIPTION
    Creates new files and opens them in your editor window
.EXAMPLE
    PS > New-EditorFile './foo.ps1'
    Creates and opens a new foo.ps1 in your editor
.EXAMPLE
    PS > Get-Process | New-EditorFile proc.txt
    Creates and opens a new foo.ps1 in your editor with the contents of the call to Get-Process
.EXAMPLE
    PS > Get-Process | New-EditorFile proc.txt -Force
    Creates and opens a new foo.ps1 in your editor with the contents of the call to Get-Process. Overwrites the file if it already exists
.INPUTS
    Path
    an array of files you want to open in your editor
    Value
    The content you want in the new files
    Force
    Overwrites a file if it exists
#>
function New-EditorFile {
    [CmdletBinding()]
    param(
        [Parameter()]
        [String[]]
        [ValidateNotNullOrEmpty()]
        $Path,

        [Parameter(ValueFromPipeline=$true)]
        $Value,

        [Parameter()]
        [switch]
        $Force
    )

    begin {
        $valueList = @()
    }

    process {
        $valueList += $Value
    }

    end {
        if ($Path) {
            foreach ($fileName in $Path)
            {
                if (-not (Test-Path $fileName) -or $Force) {
                    New-Item -Path $fileName -ItemType File | Out-Null

                    if ($Path.Count -gt 1) {
                        $preview = $false
                    } else {
                        $preview = $true
                    }

                    $psEditor.Workspace.OpenFile($fileName, $preview)
                    $psEditor.GetEditorContext().CurrentFile.InsertText(($valueList | Out-String))
                } else {
                    $PSCmdlet.WriteError( (
                        New-Object -TypeName System.Management.Automation.ErrorRecord -ArgumentList @(
                            [System.IO.IOException]"The file '$fileName' already exists.",
                            'NewEditorFileIOError',
                            [System.Management.Automation.ErrorCategory]::WriteError,
                            $fileName) ) )
                }
            }
        } else {
            $psEditor.Workspace.NewFile()
            $psEditor.GetEditorContext().CurrentFile.InsertText(($valueList | Out-String))
        }
    }
}

function Open-EditorFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true, ValueFromPipeline=$true)]
        [ValidateNotNullOrEmpty()]
        $Path
    )

    begin {
        $Paths = @()
    }

    process {
        $Paths += $Path
    }

    end {
        if ($Paths.Count -gt 1) {
            $preview = $false
        } else {
            $preview = $true
        }

        Get-ChildItem $Paths -File | ForEach-Object {
            $psEditor.Workspace.OpenFile($_.FullName, $preview)
        }
    }
}
Set-Alias psedit Open-EditorFile -Scope Global

Export-ModuleMember -Function Open-EditorFile,New-EditorFile

# SIG # Begin signature block
# MIIdhgYJKoZIhvcNAQcCoIIddzCCHXMCAQExCzAJBgUrDgMCGgUAMGkGCisGAQQB
# gjcCAQSgWzBZMDQGCisGAQQBgjcCAR4wJgIDAQAABBAfzDtgWUsITrck0sYpfvNR
# AgEAAgEAAgEAAgEAAgEAMCEwCQYFKw4DAhoFAAQUJsHDByFS+WrIQDrcz7R4b8hJ
# o/ugghhUMIIEwjCCA6qgAwIBAgITMwAAAMRudtBNPf6pZQAAAAAAxDANBgkqhkiG
# 9w0BAQUFADB3MQswCQYDVQQGEwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4G
# A1UEBxMHUmVkbW9uZDEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMSEw
# HwYDVQQDExhNaWNyb3NvZnQgVGltZS1TdGFtcCBQQ0EwHhcNMTYwOTA3MTc1ODUy
# WhcNMTgwOTA3MTc1ODUyWjCBsjELMAkGA1UEBhMCVVMxEzARBgNVBAgTCldhc2hp
# bmd0b24xEDAOBgNVBAcTB1JlZG1vbmQxHjAcBgNVBAoTFU1pY3Jvc29mdCBDb3Jw
# b3JhdGlvbjEMMAoGA1UECxMDQU9DMScwJQYDVQQLEx5uQ2lwaGVyIERTRSBFU046
# MjEzNy0zN0EwLTRBQUExJTAjBgNVBAMTHE1pY3Jvc29mdCBUaW1lLVN0YW1wIFNl
# cnZpY2UwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCoA5rFUpl2jKM9
# /L26GuVj6Beo87YdPTwuOL0C+QObtrYvih7LDNDAeWLw+wYlSkAmfmaSXFpiRHM1
# dBzq+VcuF8YGmZm/LKWIAB3VTj6df05JH8kgtp4gN2myPTR+rkwoMoQ3muR7zb1n
# vNiLsEpgJ2EuwX5M/71uYrK6DHAPbbD3ryFizZAfqYcGUWuDhEE6ZV+onexUulZ6
# DK6IoLjtQvUbH1ZMEWvNVTliPYOgNYLTIcJ5mYphnUMABoKdvGDcVpSmGn6sLKGg
# iFC82nun9h7koj7+ZpSHElsLwhWQiGVWCRVk8ZMbec+qhu+/9HwzdVJYb4HObmwN
# Daqpqe17AgMBAAGjggEJMIIBBTAdBgNVHQ4EFgQUiAUj6xG9EI77i5amFSZrXv1V
# 3lAwHwYDVR0jBBgwFoAUIzT42VJGcArtQPt2+7MrsMM1sw8wVAYDVR0fBE0wSzBJ
# oEegRYZDaHR0cDovL2NybC5taWNyb3NvZnQuY29tL3BraS9jcmwvcHJvZHVjdHMv
# TWljcm9zb2Z0VGltZVN0YW1wUENBLmNybDBYBggrBgEFBQcBAQRMMEowSAYIKwYB
# BQUHMAKGPGh0dHA6Ly93d3cubWljcm9zb2Z0LmNvbS9wa2kvY2VydHMvTWljcm9z
# b2Z0VGltZVN0YW1wUENBLmNydDATBgNVHSUEDDAKBggrBgEFBQcDCDANBgkqhkiG
# 9w0BAQUFAAOCAQEAcDh+kjmXvCnoEO5AcUWfp4/4fWCqiBQL8uUFq6cuBuYp8ML4
# UyHSLKNPOoJmzzy1OT3GFGYrmprgO6c2d1tzuSaN3HeFGENXDbn7N2RBvJtSl0Uk
# ahSyak4TsRUPk/WwMQ0GOGNbxjolrOR41LVsSmHVnn8IWDOCWBj1c+1jkPkzG51j
# CiAnWzHU1Q25A/0txrhLYjNtI4P3f0T0vv65X7rZAIz3ecQS/EglmADfQk/zrLgK
# qJdxZKy3tXS7+35zIrDegdAH2G7d3jvCNTjatrV7cxKH+ZX9oEsFl10uh/U83KA2
# QiQJQMtbjGSzQV2xRpcNf2GpHBRPW0sK4yL3wzCCBgEwggPpoAMCAQICEzMAAADE
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
# BDEWBBQgDofuSL00r4gA3ivKqAM6NPvb+zBQBgorBgEEAYI3AgEMMUIwQKAWgBQA
# UABvAHcAZQByAFMAaABlAGwAbKEmgCRodHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20v
# UG93ZXJTaGVsbCAwDQYJKoZIhvcNAQEBBQAEggEABP9JczeYJPmxNLhPBp35MIIe
# 9jSvf+T1PVO0Ryo1Wx3Vn7mlNri4VQG8Vs4iArdKyV5d/JXsKGQ6vRYorgguXaXu
# GG49lq7ZItAg4FqPYH9d34Q6VNHY9USwkh/wJHHy49hxuheEJsmFPhWz8FsFr6YZ
# 7S4RTxpxu+I58bYrMbqOTKF9gTSFH+B7aYRWU/oJWGcAZHqBNRM2gUB+kFwfZCKU
# DyI3sPbo9TprSDT41Kz/vHKgr3cQhssBD1v9NcrFAHJenXQ09zgu2BGjwojmjq5b
# UowRwtKX181ym5c7iyZwea9gv3vMUsjv2P+DXZuL/wizmrwKfpWVEW6rizS+haGC
# AigwggIkBgkqhkiG9w0BCQYxggIVMIICEQIBATCBjjB3MQswCQYDVQQGEwJVUzET
# MBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9uZDEeMBwGA1UEChMV
# TWljcm9zb2Z0IENvcnBvcmF0aW9uMSEwHwYDVQQDExhNaWNyb3NvZnQgVGltZS1T
# dGFtcCBQQ0ECEzMAAADEbnbQTT3+qWUAAAAAAMQwCQYFKw4DAhoFAKBdMBgGCSqG
# SIb3DQEJAzELBgkqhkiG9w0BBwEwHAYJKoZIhvcNAQkFMQ8XDTE4MDQyNjE3NTE1
# OFowIwYJKoZIhvcNAQkEMRYEFB7D3lsLwsZ6GLexxjvfi3YSfK1oMA0GCSqGSIb3
# DQEBBQUABIIBADBWkyiI4yNIaZywbZTGNBfsOg8uCC2t5ztNmxKFTWZWjUsycsSX
# 4SwRh4A6aVY3TRqfPhweeyLFJ8mo2iUOBoaVnXDNrEIX9Qd9eCSG3FbyKrUBDKF7
# G5mi6UAvzgz9IocfsQKeSUrA43k3dhOnoldmDQYb6UAzV483Sa4Nxpqbko+RhoZa
# +hGacO5U92IEqtszIKVN3vrWo19O8TjI565Wjq1nPDRnrdm+tv0N60eD9BNSLkhv
# MiRtPzPb1uIKMKI4vHneJM7JN7HHzREegjma+4394MsCVrCJStmh/a2i7IbRqeE0
# 6VIJX/p9hf4YXXjATHH78UsTspyDZ2Yj5dc=
# SIG # End signature block