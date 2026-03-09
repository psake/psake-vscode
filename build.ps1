[CmdletBinding()]
param(
    [ValidateSet('Default', 'Build', 'Test', 'Package', 'CI', 'Clean')]
    [string]$Task = 'Default',

    [switch]$Bootstrap
)

$ErrorActionPreference = 'Stop'

if ($Bootstrap) {
    Write-Host 'Bootstrapping build dependencies...' -ForegroundColor Cyan

    # Ensure psake is available
    if (-not (Get-Module -ListAvailable -Name psake)) {
        Write-Host 'Installing psake module...'
        Install-Module -Name psake -Scope CurrentUser -Force -SkipPublisherCheck
    }

    # Ensure Node.js dependencies are installed
    if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))) {
        Write-Host 'Installing npm dependencies...'
        Push-Location $PSScriptRoot
        npm ci
        Pop-Location
    }
}

Import-Module psake

$psakeParams = @{
    buildFile = Join-Path $PSScriptRoot 'psakefile.ps1'
    taskList = $Task
    nologo = $true
}

Invoke-psake @psakeParams

if (-not $psake.build_success) {
    throw 'Build failed!'
}
