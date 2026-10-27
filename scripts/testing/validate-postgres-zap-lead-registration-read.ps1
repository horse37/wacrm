param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskId = '20261021-072715-1f87'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-zap-lead-registration-db-$suffix"
$nodeContainer = "wacrm-zap-lead-registration-node-$suffix"
$bootstrapUser = 'db_wacrm_zap_lead_registration_bootstrap'
$runtimeUser = 'wacrm_zap_lead_registration_read_runtime'
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$taskLog = [System.IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot "../../.harness/tasks/$taskId/validation-postgres-zap-lead-registration-read-$suffix.log")
)

if (Test-Path -LiteralPath $taskLog) {
  throw "Refusing to overwrite existing validation log: $taskLog"
}

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
    "Command: Docker Desktop disposable PostgreSQL validation; images $PostgresImage and $NodeImage, --network none, PostgreSQL data in task-owned tmpfs, repository mounted read-only.",
    'The fixture uses only synthetic accounts, keys, URLs, and state. No Supabase or external service is contacted.'
  )

  Invoke-DockerChecked @(
    'run', '--pull=never', '-d', '--rm', '--name', $databaseContainer,
    '--network', 'none', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', "POSTGRES_USER=$bootstrapUser", '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null

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
    throw 'Disposable PostgreSQL container did not become ready within 60 seconds.'
  }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', $bootstrapUser, '-d', 'postgres', '-f',
    "/repo/.harness/tasks/$taskId/postgres-zap-lead-registration-read-fixture.sql"
  ) | Out-Null

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', $bootstrapUser, '-d', 'postgres', '-c',
    "ALTER ROLE $runtimeUser PASSWORD '$runtimePassword'"
  ) | Out-Null

  $databaseUrl = "postgres://$runtimeUser`:$runtimePassword@127.0.0.1:5432/postgres"
  $nodeArgs = @(
    'run', '--pull=never', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '--workdir', '/repo', '-e', "DATABASE_URL=$databaseUrl", '-e', 'PG_POOL_MAX=1',
    $NodeImage, 'node', '--conditions=react-server', '--import',
    './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    'scripts/testing/postgres-zap-lead-registration-read-integration.mjs'
  )
  $nodeOutput = & docker @nodeArgs 2>&1
  $nodeExitCode = $LASTEXITCODE
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Node integration exit code: $nodeExitCode"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value (
    @($nodeOutput | ForEach-Object { $_.ToString() }) -join "`n"
  )
  if ($nodeExitCode -ne 0) {
    throw "PostgreSQL Zap Lead registration read integration failed with exit $nodeExitCode."
  }

  $validationSucceeded = $true
} catch {
  $primaryFailure = $_.Exception.Message
  if (Test-Path -LiteralPath $taskLog) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Validation failure: $primaryFailure"
  }
} finally {
  $ErrorActionPreference = 'Continue'
  & docker rm -f $databaseContainer 2>&1 | Out-Null
  & docker rm -f $nodeContainer 2>&1 | Out-Null
  $residual = @(& docker ps -a --filter "name=$suffix" --format '{{.Names}}' 2>$null)
  $cleanup = if ($residual.Count -eq 0) {
    'no residual task containers'
  } else {
    "residual containers: $($residual -join ', ')"
  }
  if ($residual.Count -gt 0) {
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
  Write-Error "PostgreSQL Zap Lead registration validation failed: $primaryFailure"
  exit 1
}

Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
Write-Output "SUCCESS: disposable PostgreSQL Zap Lead registration read validation. Log: $taskLog"
