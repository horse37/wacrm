[CmdletBinding()]
param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskId = '20261021-013249-b008'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-template-edit-db-$suffix"
$nodeContainer = "wacrm-template-edit-node-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$fixturePath = Join-Path $repoRoot ".harness/tasks/$taskId/postgres-template-edit-persistence-fixture.sql"
$integrationPath = Join-Path $repoRoot 'scripts/testing/postgres-template-edit-persistence-integration.mjs'
$taskDirectory = Join-Path $repoRoot ".harness/tasks/$taskId"
$taskLog = Join-Path $taskDirectory "validation-postgres-template-edit-persistence-$suffix.log"
$validationSucceeded = $false
$primaryFailure = $null

function Invoke-DockerChecked {
  param([string[]]$Arguments)
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & docker @Arguments 2>&1
    $code = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($code -ne 0) {
    $detail = @($output | ForEach-Object { $_.ToString() }) -join "`n"
    throw "docker $($Arguments[0]) failed with exit $code`n$detail"
  }
  return $output
}

try {
  $dockerContext = (& docker context show 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $dockerContext -ne 'desktop-linux') {
    throw "Expected Docker Desktop context 'desktop-linux'; received '$dockerContext'."
  }
  foreach ($image in @($PostgresImage, $NodeImage)) {
    & docker image inspect $image *> $null
    if ($LASTEXITCODE -ne 0) { throw "Required local image not available: $image" }
  }
  if (-not (Test-Path -LiteralPath $fixturePath) -or -not (Test-Path -LiteralPath $integrationPath)) {
    throw 'PostgreSQL fixture or integration runner is missing.'
  }
  $fixture = Get-Content -LiteralPath $fixturePath -Raw
  foreach ($table in @('accounts', 'profiles', 'message_templates', 'whatsapp_config')) {
    if ($fixture -notmatch "ALTER TABLE public\.$table ENABLE ROW LEVEL SECURITY;\s*ALTER TABLE public\.$table FORCE ROW LEVEL SECURITY;") {
      throw "Fixture must enable and force RLS on public.$table."
    }
  }
  if ($fixture -notmatch 'NOBYPASSRLS') { throw 'Runtime role must set NOBYPASSRLS.' }

  if (Test-Path -LiteralPath $taskLog) { throw "Refusing to overwrite validation log: $taskLog" }
  $postgresImageId = (& docker image inspect --format '{{.Id}}' $PostgresImage).Trim()
  $nodeImageId = (& docker image inspect --format '{{.Id}}' $NodeImage).Trim()
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Docker Desktop context: $dockerContext",
    "PostgreSQL image ID: $postgresImageId",
    "Node image ID: $nodeImageId",
    'Database: wacrm_template_edit_task; synthetic fixtures only; no published ports; no external network.'
  )

  Invoke-DockerChecked @(
    'run', '--pull=never', '-d', '--rm', '--name', $databaseContainer,
    '--network', 'none', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '-e', 'POSTGRES_USER=postgres', '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=wacrm_template_edit_task', $PostgresImage
  ) | Out-Null

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U postgres -d wacrm_template_edit_task *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'wacrm_template_edit_task', '-f',
    "/source/.harness/tasks/$taskId/postgres-template-edit-persistence-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'wacrm_template_edit_task', '-c',
    "ALTER ROLE wacrm_template_edit_runtime PASSWORD '$runtimePassword'"
  ) | Out-Null

  $databaseUrl = "postgres://wacrm_template_edit_runtime:$runtimePassword@127.0.0.1:5432/wacrm_template_edit_task"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    'Runner: Node 22 in a container sharing only the isolated PostgreSQL loopback namespace.',
    'Repository mount is read-only; database data uses disposable tmpfs.',
    'DATABASE_URL password redacted; WACRM_TEMPLATE_EDIT_POSTGRES_TEST=1.'
  )
  $runnerOutput = @(& docker run --pull=never --rm --name $nodeContainer `
    --network "container:$databaseContainer" `
    --mount "type=bind,source=$repoRoot,target=/source,readonly" `
    --workdir /source `
    -e "DATABASE_URL=$databaseUrl" `
    -e 'WACRM_TEMPLATE_EDIT_POSTGRES_TEST=1' `
    -e 'PG_POOL_MAX=4' `
    -e 'TZ=UTC' `
    $NodeImage --conditions=react-server `
    --import ./scripts/testing/register-typescript-extensionless-loader.mjs `
    --experimental-strip-types --experimental-default-type=module `
    scripts/testing/postgres-template-edit-persistence-integration.mjs 2>&1)
  $runnerExitCode = $LASTEXITCODE
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value ($runnerOutput | ForEach-Object { $_.ToString() })
  if ($runnerExitCode -ne 0) { throw "PostgreSQL integration failed with exit $runnerExitCode." }
  $validationSucceeded = $true
}
catch {
  $primaryFailure = $_.Exception.Message
  if (Test-Path -LiteralPath $taskDirectory) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Validation failure: $primaryFailure"
  }
}
finally {
  $ErrorActionPreference = 'Continue'
  $cleanupFailures = [System.Collections.Generic.List[string]]::new()
  foreach ($containerName in @($databaseContainer, $nodeContainer)) {
    $listed = @(& docker ps -a --filter "name=$containerName" --format '{{.Names}}' 2>&1)
    $listCode = $LASTEXITCODE
    if ($listCode -ne 0) {
      $cleanupFailures.Add("Could not inspect $containerName (exit $listCode).")
      continue
    }
    if ($listed -contains $containerName) {
      & docker rm -f $containerName *> $null
      if ($LASTEXITCODE -ne 0) { $cleanupFailures.Add("Could not remove $containerName.") }
    }
  }
  $residual = @(& docker ps -a --filter "name=$suffix" --format '{{.Names}}' 2>&1)
  if ($LASTEXITCODE -ne 0) { $cleanupFailures.Add('Could not verify disposable container cleanup.') }
  elseif ($residual.Count -gt 0) { $cleanupFailures.Add('Disposable task containers remain: ' + ($residual -join ', ')) }
  if ($cleanupFailures.Count -eq 0 -and (Test-Path -LiteralPath $taskLog)) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Cleanup: disposable database and runner containers removed; residual count 0.'
  }
  if ($cleanupFailures.Count -gt 0 -and (Test-Path -LiteralPath $taskLog)) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value ('Cleanup failure: ' + ($cleanupFailures -join '; '))
  }
}

if ($cleanupFailures.Count -gt 0) {
  throw ($cleanupFailures -join '; ')
}
if (-not $validationSucceeded) {
  throw "FAILURE: PostgreSQL template-edit persistence validation. $primaryFailure. Log: $taskLog"
}
Write-Output "SUCCESS: PostgreSQL template-edit persistence validation. Log: $taskLog"
