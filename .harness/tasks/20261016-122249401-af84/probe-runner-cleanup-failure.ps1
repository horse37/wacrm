$ErrorActionPreference = 'Stop'
$taskDirectory = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $taskDirectory '../../..')).Path
$validator = Join-Path $repoRoot 'scripts/testing/validate-postgres-migration-runner.ps1'
$existingLogs = @(
  Get-ChildItem -LiteralPath $taskDirectory -Filter 'validation-review-corrections-*.log' |
    ForEach-Object { $_.FullName }
)
$existingDockerFunction = Get-Item Function:\docker -ErrorAction SilentlyContinue
$global:failureProbeTemporaryDirectoryExistedAtDockerRun = $false

function global:docker {
  switch ([string]$args[0]) {
    'run' {
      $databaseContainerArgument = @($args | Where-Object { $_ -like 'wacrm-migration-db-*' } | Select-Object -First 1)
      if ($databaseContainerArgument.Count -gt 0) {
        $runSuffix = $databaseContainerArgument[0].Substring('wacrm-migration-db-'.Length)
        $runTemporaryDirectory = Join-Path $env:TEMP "wacrm-pg-validation-$runSuffix"
        $global:failureProbeTemporaryDirectoryExistedAtDockerRun = Test-Path -LiteralPath $runTemporaryDirectory
      }
      $global:LASTEXITCODE = 71
      [Console]::Error.WriteLine('injected primary Docker startup failure')
      return
    }
    'ps' {
      $global:LASTEXITCODE = 72
      [Console]::Error.WriteLine('injected cleanup inspection failure')
      return
    }
    default {
      $global:LASTEXITCODE = 73
      [Console]::Error.WriteLine('unexpected Docker command in failure-path probe')
      return
    }
  }
}

$probeException = $null
try {
  & $validator *>&1 | Out-Null
}
catch {
  $probeException = $_.Exception.ToString()
}
finally {
  if ($existingDockerFunction) {
    Set-Item -Path Function:\docker -Value $existingDockerFunction.ScriptBlock
  }
  else {
    Remove-Item -Path Function:\docker -ErrorAction SilentlyContinue
  }
}

if (-not $probeException) { throw 'Expected validation failure was not raised.' }

$newLog = Get-ChildItem -LiteralPath $taskDirectory -Filter 'validation-review-corrections-*.log' |
  Where-Object { $_.FullName -notin $existingLogs } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $newLog) { throw 'The failure-path probe did not create a new validation log.' }

$suffix = [System.IO.Path]::GetFileNameWithoutExtension($newLog.Name).Substring('validation-review-corrections-'.Length)
$logText = Get-Content -LiteralPath $newLog.FullName -Raw
$temporaryDirectory = Join-Path $env:TEMP "wacrm-pg-validation-$suffix"
$validatorText = Get-Content -LiteralPath $validator -Raw
$expectations = @(
  @{
    Name = 'primary validation failure appears in the thrown diagnostic'
    Passed = $probeException.Contains('Primary validation failure: docker run failed with exit 71')
  },
  @{
    Name = 'runner cleanup failure appears in the thrown diagnostic'
    Passed = $probeException.Contains("Could not inspect task-owned container wacrm-migration-runner-$suffix during cleanup (exit 72).")
  },
  @{
    Name = 'database cleanup failure appears in the thrown diagnostic'
    Passed = $probeException.Contains("Could not inspect task-owned container wacrm-migration-db-$suffix during cleanup (exit 72).")
  },
  @{
    Name = 'primary and cleanup failures are recorded in the task log'
    Passed = $logText.Contains('Primary validation failure: docker run failed with exit 71') -and
      $logText.Contains('Cleanup failures:') -and
      $logText.Contains("wacrm-migration-runner-$suffix") -and
      $logText.Contains("wacrm-migration-db-$suffix")
  },
  @{
    Name = 'temporary dependencies are removed after failures'
    Passed = $global:failureProbeTemporaryDirectoryExistedAtDockerRun -and
      -not (Test-Path -LiteralPath $temporaryDirectory)
  },
  @{
    Name = 'cleanup guard requires exact generated suffix and exact TEMP parent'
    Passed = $validatorText -match '\[string\]::Equals\(\$dependencyParent, \$tempRoot, \[System.StringComparison\]::OrdinalIgnoreCase\)' -and
      $validatorText -match '\$dependencyLeaf -cne "wacrm-pg-validation-\$suffix"'
  }
)

$failedExpectations = @($expectations | Where-Object { -not $_.Passed })
foreach ($expectation in $expectations) {
  Write-Output "$($expectation.Name): $($expectation.Passed)"
}
Write-Output "Probe log: $($newLog.Name)"
if ($failedExpectations.Count -gt 0) { throw 'One or more cleanup failure-path assertions failed.' }
