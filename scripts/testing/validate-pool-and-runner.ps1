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
$temporaryRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd(
  [System.IO.Path]::DirectorySeparatorChar,
  [System.IO.Path]::AltDirectorySeparatorChar
)
$dependencyDir = [System.IO.Path]::GetFullPath(
  (Join-Path $temporaryRoot "wacrm-pg-validation-$suffix")
)
if (
  -not $dependencyDir.StartsWith(
    $temporaryRoot + [System.IO.Path]::DirectorySeparatorChar,
    [System.StringComparison]::OrdinalIgnoreCase
  ) -or
  [System.IO.Path]::GetFileName($dependencyDir) -notmatch '^wacrm-pg-validation-[a-f0-9]{10}$'
) {
  throw 'Temporary dependency cleanup path is outside its expected directory.'
}
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$migratorPassword = [guid]::NewGuid().ToString('N')
$taskLog = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../.harness/tasks/20261021-113450-6f2c/validation-postgres-runtime-role-guard-$suffix.log"))
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
  $dependencyNodeModules = Join-Path $dependencyDir 'node_modules'
  New-Item -ItemType Directory -Path $dependencyNodeModules | Out-Null
  $pendingPackages = [System.Collections.Generic.Queue[string]]::new()
  $pendingPackages.Enqueue('pg')
  $pendingPackages.Enqueue('server-only')
  $copiedPackages = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
  )
  while ($pendingPackages.Count -gt 0) {
    $packageName = $pendingPackages.Dequeue()
    if (-not $copiedPackages.Add($packageName)) { continue }

    $sourceDirectory = Join-Path $repoRoot "node_modules\$packageName"
    if (-not (Test-Path -LiteralPath $sourceDirectory -PathType Container)) {
      throw "Installed PostgreSQL dependency is missing: $packageName"
    }
    $packageManifest = Get-Content -Raw -LiteralPath (Join-Path $sourceDirectory 'package.json') | ConvertFrom-Json
    if ($packageName -eq 'pg' -and $packageManifest.version -ne '8.16.3') {
      throw "Expected pg@8.16.3, found pg@$($packageManifest.version)."
    }

    Copy-Item -LiteralPath $sourceDirectory -Destination $dependencyNodeModules -Recurse
    foreach ($dependencyName in $packageManifest.dependencies.PSObject.Properties.Name) {
      $pendingPackages.Enqueue($dependencyName)
    }
  }

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
    -Command "$copyCommand && node --conditions=react-server --experimental-strip-types --experimental-default-type=module scripts/testing/pool-runtime-integration.mjs" `
    -EnvArgs @('-e', "DATABASE_URL=$runtimeUrl")

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'bootstrap_admin', '-d', 'postgres',
    '-c', 'GRANT CREATE ON SCHEMA public TO wacrm_runtime; SET ROLE wacrm_runtime; CREATE TABLE public.pool_runtime_owned_probe (id integer); ALTER TABLE public.pool_runtime_owned_probe ENABLE ROW LEVEL SECURITY; RESET ROLE; REVOKE CREATE ON SCHEMA public FROM wacrm_runtime'
  ) | Out-Null
  Invoke-NodeStep -Label 'pool-owned-rls-table-rejected' `
    -Command "$copyCommand && node --conditions=react-server --experimental-strip-types --experimental-default-type=module scripts/testing/pool-privileged-role-integration.mjs" `
    -EnvArgs @('-e', "DATABASE_URL=$runtimeUrl")

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'bootstrap_admin', '-d', 'postgres',
    '-c', 'CREATE ROLE wacrm_pool_bypass_probe NOLOGIN BYPASSRLS',
    '-c', 'GRANT wacrm_pool_bypass_probe TO wacrm_runtime'
  ) | Out-Null
  Invoke-NodeStep -Label 'pool-bypass-membership-rejected' `
    -Command "$copyCommand && node --conditions=react-server --experimental-strip-types --experimental-default-type=module scripts/testing/pool-privileged-role-integration.mjs" `
    -EnvArgs @('-e', "DATABASE_URL=$runtimeUrl")
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'bootstrap_admin', '-d', 'postgres',
    '-c', 'REVOKE wacrm_pool_bypass_probe FROM wacrm_runtime',
    '-c', 'DROP ROLE wacrm_pool_bypass_probe'
  ) | Out-Null

  $adminUrl = "postgres://bootstrap_admin:$bootstrapPassword@127.0.0.1:5432/postgres"
  Invoke-NodeStep -Label 'pool-privileged-role-rejected' `
    -Command "$copyCommand && node --conditions=react-server --experimental-strip-types --experimental-default-type=module scripts/testing/pool-privileged-role-integration.mjs" `
    -EnvArgs @('-e', "DATABASE_URL=$adminUrl")

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
