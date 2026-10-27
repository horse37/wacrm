param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm',
  [string]$TaskId = '20261020-212612-34b1'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskId = $TaskId
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 12)
$databaseContainer = "wacrm-whatsapp-config-post-db-$suffix"
$nodeContainer = "wacrm-whatsapp-config-post-node-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$taskLog = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../.harness/tasks/$taskId/validation-postgres-whatsapp-config-post-$suffix.log"))

if (Test-Path -LiteralPath $taskLog) {
  throw "Refusing to overwrite existing validation log: $taskLog"
}

function Invoke-DockerChecked {
  param([string[]]$Arguments)

  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & docker @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  if ($exitCode -ne 0) {
    $detail = @($output | ForEach-Object { $_.ToString() }) -join "`n"
    throw "Docker command '$($Arguments[0])' failed with exit $exitCode`: $detail"
  }

  return $output
}

$validationSucceeded = $false
$primaryFailure = $null

try {
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "PostgreSQL WhatsApp config POST validation started: $(Get-Date -Format o)"
  $dockerVersion = Invoke-DockerChecked @('version', '--format', '{{.Server.Version}}')
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Docker Desktop server: $($dockerVersion -join '')"

  Invoke-DockerChecked @(
    'run', '-d', '--rm', '--name', $databaseContainer,
    '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', 'POSTGRES_USER=db_whatsapp_config_bootstrap',
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres',
    $PostgresImage
  ) | Out-Null

  $postgresImageId = Invoke-DockerChecked @('image', 'inspect', '--format', '{{.Id}}', $PostgresImage)
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "PostgreSQL image ID: $($postgresImageId -join '')"

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U db_whatsapp_config_bootstrap -d postgres *> $null
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
    '-U', 'db_whatsapp_config_bootstrap', '-d', 'postgres', '-f',
    "/repo/.harness/tasks/20261020-135551-7b0e/postgres-whatsapp-config-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_whatsapp_config_bootstrap', '-d', 'postgres', '-f',
    "/repo/.harness/tasks/$taskId/postgres-whatsapp-config-post-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_whatsapp_config_bootstrap', '-d', 'postgres', '-c',
    "ALTER ROLE wacrm_whatsapp_config_runtime PASSWORD '$runtimePassword'"
  ) | Out-Null

  $databaseUrl = "postgres://wacrm_whatsapp_config_runtime:$runtimePassword@127.0.0.1:5432/postgres"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Runtime DSN uses task-generated credentials: $($databaseUrl -replace ':[^:@]+@', ':<redacted>@')"
  $nodeArgs = @(
    'run', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--workdir', '/source',
    '-e', "DATABASE_URL=$databaseUrl",
    '-e', 'PG_POOL_MAX=1',
    $NodeImage,
    'node', '--conditions=react-server', '--import',
    './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    'scripts/testing/postgres-whatsapp-config-post-integration.mjs'
  )
  $nodeOutput = & docker @nodeArgs 2>&1
  $nodeExitCode = $LASTEXITCODE
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Node integration exit code: $nodeExitCode"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value (@($nodeOutput | ForEach-Object { $_.ToString() }) -join "`n")
  if ($nodeExitCode -ne 0) {
    throw "Node PostgreSQL WhatsApp config POST integration failed with exit $nodeExitCode."
  }

  $validationSucceeded = $true
} catch {
  $primaryFailure = $_.Exception.Message
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Validation failure: $primaryFailure"
} finally {
  $ErrorActionPreference = 'Continue'
  & docker rm -f $databaseContainer 2>&1 | Out-Null
  & docker rm -f $nodeContainer 2>&1 | Out-Null
  $residual = @(& docker ps -a --filter "name=$suffix" --format '{{.Names}}' 2>$null)
  $cleanup = if ($residual.Count -eq 0) { 'no residual task resources' } else { "residual containers: $($residual -join ', ')" }
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Cleanup: $cleanup"
}

if (-not $validationSucceeded) {
  Write-Error "FAILURE: $primaryFailure; evidence: $taskLog"
  exit 1
}
if ($cleanup -ne 'no residual task resources') {
  Write-Error "FAILURE: $cleanup; evidence: $taskLog"
  exit 1
}

Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'SUCCESS: isolated Docker PostgreSQL integration passed.'
Write-Output "SUCCESS: PostgreSQL WhatsApp config POST integration. Evidence: $taskLog"
