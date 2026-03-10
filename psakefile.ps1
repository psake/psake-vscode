Properties {
    $ProjectRoot = $PSScriptRoot
    $OutDir = Join-Path $ProjectRoot 'out'
}

Task Default -Depends Build -Description 'Default task; runs the full Build pipeline'

Task Clean -Description 'Removes the out/ directory and any .vsix files from the project root' {
    if (Test-Path $OutDir) {
        Write-Host "Removing $OutDir" -ForegroundColor Yellow
        Remove-Item -Recurse -Force $OutDir
    }

    $vsixFiles = Get-ChildItem -Path $ProjectRoot -Filter '*.vsix' -ErrorAction SilentlyContinue
    foreach ($f in $vsixFiles) {
        Write-Host "Removing $($f.Name)" -ForegroundColor Yellow
        Remove-Item -Force $f.FullName
    }
}

Task Build -Depends Clean -Description 'Compiles the extension with esbuild and type-checks the source with tsc' {
    Push-Location $ProjectRoot
    try {
        Write-Host 'Building extension (esbuild)...' -ForegroundColor Cyan
        Exec { npm run build }

        Write-Host 'Type-checking source...' -ForegroundColor Cyan
        Exec { npx tsc --noEmit }
    } finally {
        Pop-Location
    }
}

Task Test -Depends Build -Description 'Type-checks the test suite with tsc using tsconfig.test.json' {
    Push-Location $ProjectRoot
    try {
        Write-Host 'Type-checking tests...' -ForegroundColor Cyan
        Exec { npx tsc -p tsconfig.test.json --noEmit }
    } finally {
        Pop-Location
    }
}

Task Package -Depends Test -Description 'Packages the extension into a .vsix file under the out/ directory' {
    Push-Location $ProjectRoot
    try {
        if (-not (Test-Path $OutDir)) {
            New-Item -ItemType Directory -Path $OutDir | Out-Null
        }

        Write-Host 'Packaging VSIX...' -ForegroundColor Cyan
        Exec { npx @vscode/vsce package --out "$OutDir/" }

        $vsix = Get-ChildItem -Path $OutDir -Filter '*.vsix' | Select-Object -First 1
        Write-Host "Created: $($vsix.Name)" -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

Task CI -Depends Package -Description 'Runs the full pipeline and extracts release metadata (version, tag, changelog) for GitHub Actions' {
    # Extract release metadata for GitHub Actions
    $pkg = Get-Content -Raw (Join-Path $ProjectRoot 'package.json') | ConvertFrom-Json
    $version = $pkg.version

    Write-Host "Version: $version" -ForegroundColor Cyan

    if ($env:GITHUB_OUTPUT) {
        "version=$version" | Out-File -FilePath $env:GITHUB_OUTPUT -Append
        "tag=v$version" | Out-File -FilePath $env:GITHUB_OUTPUT -Append

        # Extract latest changelog section
        $changelog = Get-Content (Join-Path $ProjectRoot 'CHANGELOG.md') -Raw
        if ($changelog -match '(?ms)^## \[([^\]]+)\]\s*\r?\n(.*?)(?=^## |\z)') {
            $title = $Matches[1]
            $body = $Matches[2].Trim()
            "title=$title" | Out-File -FilePath $env:GITHUB_OUTPUT -Append
            $body | Out-File -FilePath (Join-Path $ProjectRoot 'release_body.md') -Encoding utf8
        }
    }
}
