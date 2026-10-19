param(
  [string]$PostgresImage = 'postgres:15',
  [string]$NodeImage = 'node:22-bookworm'
)

# Disposable PostgreSQL validation for the server-side pool and the migration runner.
# 1) getPostgresPool() real, connecting as wacrm_runtime.
# 2) runMigrations() on an isolated synthetic fixture, connecting as wacrm_migrator.
# Task-owned resources only: tmpfs database, synthetic per-run passwords, no real credentials.
# The database runs with --network none; the Node client joins its network namespace.
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-pool-db-$suffix"
$nodeContainer = "wacrm-pool-node-$suffix"
$dependencyDir = Join-Path $env:TEMP "wacrm-pg-validation-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$migratorPassword = [guid]::NewGuid().ToString('N')
$taskLog = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../.harness/tasks/20261016-122249401-af84/validation-pool-and-runner-$suffix.log"))
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

function Invoke-NodeStep {
  param([string]$Label, [string]$Command, [string[]]$EnvArgs)
  $nodeArgs = @('run', '--rm', '--name', "$nodeContainer-$Label", '--network', "container:$databaseContainer") + $EnvArgs + @(
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--mount', "type=bind,source=$(Join-Path $dependencyDir 'node_modules'),target=/deps/node_modules,readonly",
    $NodeImage, 'sh', '-c', $Command
  )
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & docker @nodeArgs 2>&1
    $code = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $text = (@($output) | ForEach-Object { $_.ToString() }) -join "`n"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "== ${Label}: node exit code $code"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value $text
  if ($code -ne 0) { throw "$Label failed with exit $code" }
}

$copyCommand = 'set -e; mkdir /work; cd /source; tar --exclude=./node_modules --exclude=./.next --exclude=./.git -cf - . | (cd /work && tar -xf -); cp -r /deps/node_modules /work/node_modules; cd /work; node --version'

try {
  New-Item -ItemType Directory -Path $dependencyDir | Out-Null
  & npm install --offline --ignore-scripts --no-audit --no-fund `
    --prefix $dependencyDir --no-save --package-lock=false pg@8.16.3
  if ($LASTEXITCODE -ne 0) { throw 'Offline install of cached pg@8.16.3 failed.' }

  Invoke-DockerChecked @(
    'run', '-d', '--rm', '--name', $databaseContainer, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '-e', 'POSTGRES_USER=bootstrap_admin',
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U bootstrap_admin -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'bootstrap_admin', '-d', 'postgres',
    '-f', '/source/scripts/testing/postgres-migration-bootstrap.sql'
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'bootstrap_admin', '-d', 'postgres',
    '-c', "ALTER ROLE wacrm_runtime LOGIN PASSWORD '$runtimePassword'",
    '-c', "ALTER ROLE wacrm_migrator LOGIN PASSWORD '$migratorPassword'"
  ) | Out-Null

  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Disposable PostgreSQL $PostgresImage, --network none, tmpfs data directory, synthetic per-run passwords.",
    'Bootstrap: scripts/testing/postgres-migration-bootstrap.sql (test-only roles).'
  )

  $runtimeUrl = "postgres://wacrm_runtime:$runtimePassword@127.0.0.1:5432/postgres"
  $migratorUrl = "postgres://wacrm_migrator:$migratorPassword@127.0.0.1:5432/postgres"

  Invoke-NodeStep -Label 'pool-runtime' `
    -Command "$copyCommand && node --experimental-strip-types --experimental-default-type=module scripts/testing/pool-runtime-integration.mjs" `
    -EnvArgs @('-e', "DATABASE_URL=$runtimeUrl")

  $adminUrl = "postgres://bootstrap_admin:$bootstrapPassword@127.0.0.1:5432/postgres"
  Invoke-NodeStep -Label 'runner-fixture' `
    -Command "$copyCommand && node scripts/testing/runner-fixture-integration.mjs" `
    -EnvArgs @('-e', "DATABASE_URL_MIGRATIONS=$migratorUrl", '-e', "DATABASE_URL_ADMIN_VERIFY=$adminUrl")

  $validationSucceeded = $true
}
catch {
  $primaryFailure = $_.Exception.Message
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Validation failure: $primaryFailure"
}
finally {
  $ErrorActionPreference = 'Continue'
  & docker rm -f $databaseContainer 2>&1 | Out-Null
  if (Test-Path -LiteralPath $dependencyDir) {
    Remove-Item -LiteralPath $dependencyDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  $residual = @(& docker ps -a --filter "name=$suffix" --format '{{.Names}}' 2>$null)
  $cleanup = if ($residual.Count -eq 0) { 'no residual task resources' } else { "residual containers: $($residual -join ', ')" }
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Cleanup: $cleanup"
}

if (-not $validationSucceeded) {
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: FAILURE'
  Write-Error "Pool and runner validation failed: $primaryFailure"
  exit 1
}
Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
Write-Output "SUCCESS: pool runtime and runner fixture; log $taskLog"
exit 0
