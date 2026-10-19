param(
  [string]$PostgresImage = 'postgres:15',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-migration-db-$suffix"
$runnerContainer = "wacrm-migration-runner-$suffix"
$dependencyDir = Join-Path $env:TEMP "wacrm-pg-validation-$suffix"
$password = [guid]::NewGuid().ToString('N')
$sourceMount = "type=bind,source=$repoRoot,target=/source,readonly"
$nodeModulesMount = "type=bind,source=$(Join-Path $dependencyDir 'node_modules'),target=/workspace/node_modules,readonly"
$taskLog = Join-Path $PSScriptRoot "../../.harness/tasks/20261016-122249401-af84/validation-review-corrections-$suffix.log"
$taskLog = [System.IO.Path]::GetFullPath($taskLog)
if (Test-Path -LiteralPath $taskLog) { throw "Refusing to overwrite existing validation log: $taskLog" }
$validationSucceeded = $false
$primaryFailure = $null

function Invoke-DockerChecked {
  param([string[]]$Arguments)
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & docker @Arguments 2>&1
    $code = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($code -ne 0) {
    $detail = @($output | ForEach-Object { $_.ToString() }) -join "`n"
    throw "docker $($Arguments[0]) failed with exit $code`n$detail"
  }
  return $output
}

try {
  New-Item -ItemType Directory -Path $dependencyDir | Out-Null
  & npm install --offline --ignore-scripts --no-audit --no-fund `
    --prefix $dependencyDir --no-save --package-lock=false pg@8.16.3
  if ($LASTEXITCODE -ne 0) { throw 'Offline install of cached pg@8.16.3 failed.' }

  $testOutput = Invoke-DockerChecked @(
    'run', '-d', '--rm', '--name', $databaseContainer, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', $sourceMount,
    '-e', 'POSTGRES_USER=bootstrap_admin',
    '-e', "POSTGRES_PASSWORD=$password",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  )
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    'Disposable PostgreSQL container started:',
    ($testOutput -join "`n")
  )

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U bootstrap_admin -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready within 30 seconds.' }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'bootstrap_admin', '-d', 'postgres',
    '-f', '/source/scripts/testing/postgres-migration-bootstrap.sql'
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'bootstrap_admin', '-d', 'postgres',
    '-c', "ALTER ROLE wacrm_migrator PASSWORD '$password'"
  ) | Out-Null

$runnerSetup = @'
mkdir -p /workspace/scripts/testing /workspace/supabase/migrations /workspace/.harness/tasks/20261016-122249401-af84
cp /source/scripts/migrate-postgres.mjs /source/scripts/migrate-postgres.test.mjs /workspace/scripts/
cp /source/scripts/testing/verify-postgres-restore.sql /workspace/scripts/testing/
cp /source/supabase/migrations/*.sql /workspace/supabase/migrations/
cp /source/.harness/tasks/20261016-122249401-af84/*-probe.sql /workspace/.harness/tasks/20261016-122249401-af84/
touch /tmp/wacrm-dependencies-ready
sleep 1200
'@
  Invoke-DockerChecked @(
    'run', '-d', '--rm', '--name', $runnerContainer,
    '--network', "container:$databaseContainer",
    '--mount', $sourceMount, '--mount', $nodeModulesMount,
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m',
    '--entrypoint', 'sh', $NodeImage, '-c', $runnerSetup
  ) | Out-Null

  $dependenciesReady = $false
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    & docker exec $runnerContainer test -f /tmp/wacrm-dependencies-ready *> $null
    if ($LASTEXITCODE -eq 0) { $dependenciesReady = $true; break }
    & docker inspect $runnerContainer *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Disposable runner container exited before dependency setup.' }
    Start-Sleep -Seconds 1
  }
  if (-not $dependenciesReady) { throw 'Disposable runner startup exceeded the 120-second task limit.' }

$focusedTestOutput = Invoke-DockerChecked @(
    'exec', $runnerContainer, 'sh', '-c',
    'cd /workspace && node --test --test-reporter=dot scripts/migrate-postgres.test.mjs'
  )
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    'Node.js focused test command: node --test --test-reporter=dot scripts/migrate-postgres.test.mjs',
    'Result: exit 0; all focused tests passed.',
    ($focusedTestOutput -join "`n")
  )

  $databaseUrl = "postgres://wacrm_migrator:$password@127.0.0.1:5432/postgres"
  $holderApp = "wacrm-migration-lock-holder-$suffix"
  Invoke-DockerChecked @(
    'exec', '-d', '-e', "PGAPPNAME=$holderApp", $databaseContainer,
    'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'bootstrap_admin', '-d', 'postgres',
    '-c', 'SELECT pg_advisory_lock(1463894866, 1); SELECT pg_sleep(5); SELECT pg_advisory_unlock(1463894866, 1)'
  ) | Out-Null
  $holderActive = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $activity = & docker exec $databaseContainer psql -X -A -t -v ON_ERROR_STOP=1 `
      -U bootstrap_admin -d postgres -c "SELECT 1 FROM pg_stat_activity WHERE application_name = '$holderApp' AND state = 'active' AND query LIKE '%pg_sleep%'"
    if ($LASTEXITCODE -eq 0 -and ($activity -join '').Trim() -eq '1') { $holderActive = $true; break }
    Start-Sleep -Milliseconds 100
  }
  if (-not $holderActive) { throw 'Could not observe advisory-lock holder active in pg_stat_activity.' }

  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  $firstRunOutput = Invoke-DockerChecked @(
    'exec', '-e', "DATABASE_URL_MIGRATIONS=$databaseUrl",
    '-e', 'WACRM_MIGRATION_OWNER_ROLE=postgres', $runnerContainer,
    'sh', '-c', 'cd /workspace && node scripts/migrate-postgres.mjs'
  )
  $timer.Stop()
  if ($timer.Elapsed.TotalSeconds -lt 2) { throw 'Migration runner did not wait for the observed lock holder.' }
  $replayOutput = Invoke-DockerChecked @(
    'exec', '-e', "DATABASE_URL_MIGRATIONS=$databaseUrl",
    '-e', 'WACRM_MIGRATION_OWNER_ROLE=postgres', $runnerContainer,
    'sh', '-c', 'cd /workspace && node scripts/migrate-postgres.mjs'
  )
  $runResults = @(
    "lock contender exit 0 after $([math]::Round($timer.Elapsed.TotalSeconds, 2))s: $($firstRunOutput -join ' ')",
    "replay exit 0: $($replayOutput -join ' ')"
  )
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    'Disposable PostgreSQL 15: Docker --network none; data directory tmpfs; synthetic bootstrap credentials.',
    'Bootstrap psql and every probe used -X -v ON_ERROR_STOP=1.',
    'Lock holder was observed active in pg_stat_activity before starting the runner contender.',
    'The lock contender waited at least two seconds, then applied migrations; the next invocation replayed.',
    $runResults
  )

  foreach ($probe in @('role-boundary-probe.sql', 'account-isolation-probe.sql')) {
    $probeOutput = Invoke-DockerChecked @(
      'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
      '-U', 'bootstrap_admin', '-d', 'postgres',
      '-f', "/source/.harness/tasks/20261016-122249401-af84/$probe"
    )
    if ($probe -eq 'role-boundary-probe.sql') {
      $probeOutput
      Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @('Role-boundary probe output:', $probeOutput)
    }
  }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'pg_dump', '-U', 'bootstrap_admin', '-d', 'postgres',
    '-Fc', '-f', '/tmp/wacrm.dump'
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'bootstrap_admin', '-d', 'postgres', '-c', 'CREATE DATABASE restore_check'
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'pg_restore', '-U', 'bootstrap_admin', '--no-owner',
    '--clean', '--if-exists', '--exit-on-error', '-d', 'restore_check', '/tmp/wacrm.dump'
  ) | Out-Null

  $manifestSql = '/source/scripts/testing/verify-postgres-restore.sql'
  $sourceManifest = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'bootstrap_admin', '-d', 'postgres', '-f', $manifestSql
  )
  $restoredManifest = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'bootstrap_admin', '-d', 'restore_check', '-f', $manifestSql
  )
  $difference = Compare-Object -ReferenceObject @($sourceManifest) -DifferenceObject @($restoredManifest)
  if ($difference) { $difference | Format-Table | Out-String | Write-Output; throw 'Restore manifest differs.' }
  if (-not (@($sourceManifest) -match '^auth-trigger\|')) { throw 'Restore manifest contains no auth.users trigger.' }
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    'pg_dump/pg_restore: full database dump included public, auth, storage, and publication objects; restore used --no-owner --clean --if-exists --exit-on-error.',
    'Restore comparison: exact sorted manifest match for migration ledger/checksums, tables, columns/defaults, RLS policy definitions, auth.users trigger definitions, and publications.',
    'Auth trigger manifest:',
    (@($sourceManifest) | Where-Object { $_ -match '^auth-trigger\|' })
  )

  foreach ($probe in @('role-boundary-probe.sql', 'account-isolation-probe.sql')) {
    $probeOutput = Invoke-DockerChecked @(
      'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
      '-U', 'bootstrap_admin', '-d', 'restore_check',
      '-f', "/source/.harness/tasks/20261016-122249401-af84/$probe"
    )
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
      "Probe $probe on restore_check:",
      (@($probeOutput) -join "`n")
    )
    if ($probe -eq 'role-boundary-probe.sql') { $probeOutput }
  }

  $validationSucceeded = $true
}
catch {
  $primaryFailure = $_.Exception.Message
  $primaryFailureContext = @(
    "Validation failure: $primaryFailure",
    "PowerShell location: $($_.InvocationInfo.PositionMessage)"
  )
  try {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value $primaryFailureContext -ErrorAction Stop
  }
  catch {
    $primaryFailure += "`nCould not record primary validation failure in ${taskLog}: $($_.Exception.Message)"
  }
}
finally {
  $cleanupFailures = [System.Collections.Generic.List[string]]::new()
  foreach ($containerName in @($runnerContainer, $databaseContainer)) {
    try {
      $containerIds = & docker ps -aq --filter "name=^/$containerName$"
      $inspectExitCode = $LASTEXITCODE
      if ($inspectExitCode -ne 0) { throw "Could not inspect task-owned container $containerName during cleanup (exit $inspectExitCode)." }
      if ($containerIds) {
        & docker rm -f $containerIds *> $null
        $removeExitCode = $LASTEXITCODE
        if ($removeExitCode -ne 0) { throw "Could not remove task-owned container $containerName (exit $removeExitCode)." }
      }
    }
    catch {
      $cleanupFailures.Add($_.Exception.Message)
    }
  }
  try {
    $tempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
    $resolvedDependencyDir = [System.IO.Path]::GetFullPath($dependencyDir)
    $dependencyParent = [System.IO.Path]::GetDirectoryName($resolvedDependencyDir).TrimEnd('\')
    $dependencyLeaf = [System.IO.Path]::GetFileName($resolvedDependencyDir)
    if (-not [string]::Equals($dependencyParent, $tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        $dependencyLeaf -cne "wacrm-pg-validation-$suffix") {
      throw "Refusing to remove dependency path outside the task temporary directory: $resolvedDependencyDir"
    }
    if (Test-Path -LiteralPath $resolvedDependencyDir) {
      Remove-Item -LiteralPath $resolvedDependencyDir -Recurse -Force -ErrorAction Stop
    }
  }
  catch {
    $cleanupFailures.Add($_.Exception.Message)
  }
  if ($cleanupFailures.Count -gt 0) {
    $failureSummary = [System.Collections.Generic.List[string]]::new()
    if ($primaryFailure) { $failureSummary.Add("Primary validation failure: $primaryFailure") }
    $failureSummary.Add('Cleanup failures:')
    foreach ($failure in $cleanupFailures) { $failureSummary.Add("- $failure") }
    try { Add-Content -LiteralPath $taskLog -Encoding utf8 -Value $failureSummary.ToArray() -ErrorAction Stop }
    catch { $failureSummary.Add("Could not record cleanup failures in ${taskLog}: $($_.Exception.Message)") }
    throw ($failureSummary -join [Environment]::NewLine)
  }
}

if ($primaryFailure) { throw $primaryFailure }
if ($validationSucceeded) {
  Write-Output "SUCCESS: offline npm install, focused tests, migration apply/replay, role probes, auth-inclusive dump/restore manifest comparison. PostgreSQL: $databaseContainer; runner: $runnerContainer"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS; all task-owned containers removed and data existed only in tmpfs.'
}
