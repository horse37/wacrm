param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskId = '20261021-060400-c97f'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-whatsapp-conversation-db-$suffix"
$nodeContainer = "wacrm-whatsapp-conversation-node-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$taskLog = [System.IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot "../../.harness/tasks/$taskId/validation-postgres-conversation-update-$suffix.log")
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
    "Command: docker run --pull=never --rm --name $databaseContainer --network none --tmpfs /var/lib/postgresql/data --mount <read-only-repository> $PostgresImage",
    'Disposable PostgreSQL 16; tmpfs database; no published ports or named volumes.',
    'Synthetic account profiles, conversations and runtime role only. Passwords generated for this run and not recorded.'
  )

  Invoke-DockerChecked @(
  'run', '--pull=never', '-d', '--rm', '--name', $databaseContainer, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', 'POSTGRES_USER=db_whatsapp_conversation_bootstrap',
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null

  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Disposable PostgreSQL image ID: $(& docker image inspect $PostgresImage --format '{{.Id}}')"

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U db_whatsapp_conversation_bootstrap -d postgres *> $null
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
    'exec', '-i', $databaseContainer, 'psql', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_whatsapp_conversation_bootstrap', '-d', 'postgres', '-f',
    "/repo/.harness/tasks/$taskId/postgres-conversation-update-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_whatsapp_conversation_bootstrap', '-d', 'postgres', '-c',
    "ALTER ROLE wacrm_whatsapp_conversation_runtime PASSWORD '$runtimePassword'"
  ) | Out-Null

  $databaseUrl = "postgres://wacrm_whatsapp_conversation_runtime:$runtimePassword@127.0.0.1:5432/postgres"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    'Command: docker run --rm --network container:<disposable-database> --mount <read-only-repository> node --conditions=react-server --import <typescript-loader> --experimental-strip-types scripts/testing/postgres-whatsapp-send-conversation-update-integration.mjs',
    "Disposable PostgreSQL image ID: $(& docker image inspect $PostgresImage --format '{{.Id}}')"
  )
  $nodeArgs = @(
    'run', '--pull=never', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--workdir', '/source', '-e', "DATABASE_URL=$databaseUrl",
    '-e', 'PG_POOL_MAX=1', $NodeImage, 'node', '--conditions=react-server',
    '--import', './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    'scripts/testing/postgres-whatsapp-send-conversation-update-integration.mjs'
  )
  $nodeOutput = & docker @nodeArgs 2>&1
  $nodeExitCode = $LASTEXITCODE
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Node integration exit code: $nodeExitCode"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value (@($nodeOutput | ForEach-Object { $_.ToString() }) -join "`n")
  if ($nodeExitCode -ne 0) {
    throw "PostgreSQL conversation update integration failed with exit $nodeExitCode."
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
  if (Test-Path -LiteralPath $taskLog) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Cleanup: $cleanup"
  }
  if ($validationSucceeded) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
  } elseif (Test-Path -LiteralPath $taskLog) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: FAILURE'
  }
}

if (-not $validationSucceeded) {
  Write-Error "PostgreSQL conversation update validation failed: $primaryFailure"
  exit 1
}

Write-Output "SUCCESS: disposable PostgreSQL conversation update integration; evidence: $taskLog"
