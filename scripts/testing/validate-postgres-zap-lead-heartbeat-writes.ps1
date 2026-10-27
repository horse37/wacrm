param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskId = '20261023-004958-ea9f'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-zap-lead-heartbeat-writes-db-$suffix"
$bootstrapUser = 'bootstrap_admin'
$migratorUser = 'wacrm_migrator'
$runtimeUser = 'wacrm_runtime'
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$migratorPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$taskLog = [System.IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot "../../.harness/tasks/$taskId/validation-postgres-zap-lead-heartbeat-writes-$suffix.log")
)

if (Test-Path -LiteralPath $taskLog) {
  throw "Refusing to overwrite existing validation log: $taskLog"
}

$databaseCreated = $false
$validationSucceeded = $false
$primaryFailure = $null

function Invoke-DockerChecked {
  param([string[]]$Arguments)

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & docker @Arguments 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($code -ne 0) {
    $detail = @($output | ForEach-Object { $_.ToString() }) -join "`n"
    throw "docker $($Arguments[0]) failed with exit $code`n$detail"
  }

  return $output
}

try {
  Invoke-DockerChecked @('image', 'inspect', $PostgresImage) | Out-Null
  Invoke-DockerChecked @('image', 'inspect', $NodeImage) | Out-Null
  New-Item -ItemType File -Path $taskLog | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: Docker Desktop PostgreSQL 16 heartbeat-writes validation with $PostgresImage and $NodeImage; --network none, disposable tmpfs database, read-only repository mount.",
    'The PostgreSQL migration runner installs the checked-in migration chain, including 028. Synthetic identities and encrypted-registration placeholders only; no Supabase service, external network, real credentials, or persistent database.'
  )

  Invoke-DockerChecked @(
    'run', '--pull=never', '-d', '--rm', '--name', $databaseContainer,
    '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', "POSTGRES_USER=$bootstrapUser",
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null
  $databaseCreated = $true

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U $bootstrapUser -d postgres 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw 'Disposable PostgreSQL did not become ready within 60 seconds.'
  }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', $bootstrapUser, '-d', 'postgres',
    '-f', '/repo/scripts/testing/postgres-migration-bootstrap.sql'
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', $bootstrapUser, '-d', 'postgres', '-c',
    "ALTER ROLE $migratorUser PASSWORD '$migratorPassword'; ALTER ROLE $runtimeUser PASSWORD '$runtimePassword'"
  ) | Out-Null

  $migrationUrl = "postgres://$migratorUser`:$migratorPassword@127.0.0.1:5432/postgres"
  $migrationOutput = & docker run --pull=never --rm --name "wacrm-zap-lead-heartbeat-writes-migrator-$suffix" `
    --network "container:$databaseContainer" `
    --read-only --tmpfs '/tmp:rw,nosuid,nodev,size=128m' `
    --mount "type=bind,source=$repoRoot,target=/repo,readonly" `
    --workdir /repo `
    -e "DATABASE_URL_MIGRATIONS=$migrationUrl" `
    -e 'WACRM_MIGRATION_OWNER_ROLE=postgres' `
    $NodeImage node scripts/migrate-postgres.mjs 2>&1
  $migrationExitCode = $LASTEXITCODE
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    'Migration runner output:',
    (@($migrationOutput | ForEach-Object { $_.ToString() }) -join "`n")
  )
  if ($migrationExitCode -ne 0) {
    throw "PostgreSQL migration runner failed with exit $migrationExitCode."
  }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', $bootstrapUser, '-d', 'postgres',
    '-f', "/repo/.harness/tasks/$taskId/postgres-zap-lead-runtime-migration-seed.sql"
  ) | Out-Null

  $preflightOutput = & docker run --pull=never --rm --name "wacrm-zap-lead-heartbeat-writes-preflight-$suffix" `
    --network "container:$databaseContainer" `
    --read-only --tmpfs '/tmp:rw,nosuid,nodev,size=128m' `
    --mount "type=bind,source=$repoRoot,target=/repo,readonly" `
    --workdir /repo `
    -e "WACRM_RUNTIME_PREFLIGHT_DATABASE_URL=postgres://$bootstrapUser`:$bootstrapPassword@127.0.0.1:5432/postgres" `
    $NodeImage node scripts/testing/verify-zap-lead-runtime-migration-preflight.mjs 2>&1
  $preflightExitCode = $LASTEXITCODE
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    'Runtime role migration preflight negative tests:',
    (@($preflightOutput | ForEach-Object { $_.ToString() }) -join "`n")
  )
  if ($preflightExitCode -ne 0) {
    throw "PostgreSQL runtime migration preflight tests failed with exit $preflightExitCode."
  }

  $databaseUrl = "postgres://$runtimeUser`:$runtimePassword@127.0.0.1:5432/postgres"
Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Applying test-only function EXECUTE grant in disposable PostgreSQL.'
Invoke-DockerChecked @(
  'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
  '-U', $bootstrapUser, '-d', 'postgres',
  '-f', "/repo/.harness/tasks/$taskId/postgres-zap-lead-heartbeat-temporary-grant.sql"
) | Out-Null
  $nodeContainer = "wacrm-zap-lead-heartbeat-writes-node-$suffix"
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $nodeOutput = & docker run --pull=never --rm --name $nodeContainer `
      --network "container:$databaseContainer" `
      --read-only --tmpfs '/tmp:rw,nosuid,nodev,size=128m' `
      --mount "type=bind,source=$repoRoot,target=/repo,readonly" `
      --workdir /repo `
      -e "DATABASE_URL=$databaseUrl" -e 'PG_POOL_MAX=4' `
      -e "WACRM_TEST_ADMIN_DATABASE_URL=postgres://$bootstrapUser`:$bootstrapPassword@127.0.0.1:5432/postgres" `
      $NodeImage node --conditions=react-server --import `
      './scripts/testing/register-typescript-extensionless-loader.mjs' `
      '--experimental-strip-types' '--experimental-default-type=module' `
      'scripts/testing/postgres-zap-lead-heartbeat-writes-integration.mjs' 2>&1
    $nodeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    'heartbeat writes integration output:',
    (@($nodeOutput | ForEach-Object { $_.ToString() }) -join "`n")
  )
  if ($nodeExitCode -ne 0) {
    throw "PostgreSQL heartbeat writes integration failed with exit $nodeExitCode."
  }

  $validationSucceeded = $true
} catch {
  $primaryFailure = $_.Exception.Message
  if (Test-Path -LiteralPath $taskLog) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Validation failure: $primaryFailure"
  }
} finally {
  $ErrorActionPreference = 'Continue'
  if ($databaseCreated) {
    & docker rm -f $databaseContainer 2>&1 | Out-Null
  }
  & docker rm -f "wacrm-zap-lead-heartbeat-writes-migrator-$suffix" 2>&1 | Out-Null
  & docker rm -f "wacrm-zap-lead-heartbeat-writes-node-$suffix" 2>&1 | Out-Null
  $residual = @(& docker ps -a --filter "name=$suffix" --format '{{.Names}}' 2>$null)
  if ($residual.Count -eq 0) {
    $cleanup = 'no residual task containers'
  } else {
    $cleanup = "residual containers: $($residual -join ', ')"
    $validationSucceeded = $false
    if (-not $primaryFailure) {
      $primaryFailure = "Disposable task containers remain after cleanup: $($residual -join ', ')"
    }
  }
  if (Test-Path -LiteralPath $taskLog) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Cleanup: $cleanup"
  }
}

if (-not $validationSucceeded) {
  if (Test-Path -LiteralPath $taskLog) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: FAILURE'
  }
  Write-Error "PostgreSQL runtime migration validation failed: $primaryFailure"
  exit 1
}

Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
Write-Output "SUCCESS: disposable PostgreSQL heartbeat writes validation. Log: $taskLog"
