param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskId = '20261020-044303-4b1e'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-message-reaction-db-$suffix"
$nodeContainer = "wacrm-message-reaction-node-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$fixturePath = Join-Path $repoRoot ".harness/tasks/$taskId/postgres-message-reaction-persistence-fixture.sql"
$repositoryPath = Join-Path $repoRoot 'src/lib/repositories/message-reaction-persistence.ts'
$integrationPath = Join-Path $repoRoot 'scripts/testing/postgres-message-reaction-persistence-integration.mjs'
$taskLog = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../.harness/tasks/$taskId/validation-postgres-message-reaction-persistence-$suffix.log"))
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
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    $PSCommandPath,
    [ref]$tokens,
    [ref]$parseErrors
  ) | Out-Null
  if ($parseErrors.Count -gt 0) {
    throw "PowerShell AST parse failed: $($parseErrors -join '; ')"
  }

  $dockerContext = (& docker context show 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $dockerContext -ne 'desktop-linux') {
    throw "Expected Docker Desktop context 'desktop-linux'; received '$dockerContext'."
  }
  foreach ($image in @($PostgresImage, $NodeImage)) {
    & docker image inspect $image *> $null
    if ($LASTEXITCODE -ne 0) { throw "Required local image is not available: $image" }
  }

  $fixture = Get-Content -LiteralPath $fixturePath -Raw
  $repository = Get-Content -LiteralPath $repositoryPath -Raw
  foreach ($table in @('accounts', 'profiles', 'conversations', 'messages', 'message_reactions')) {
    if ($fixture -notmatch "ALTER TABLE public\.$table ENABLE ROW LEVEL SECURITY;\s*ALTER TABLE public\.$table FORCE ROW LEVEL SECURITY;") {
      throw "Fixture does not enable and force RLS on public.$table."
    }
  }
  if ($fixture -notmatch 'NOBYPASSRLS') { throw 'Fixture runtime role must set NOBYPASSRLS.' }
  if ($fixture -match 'GRANT SELECT ON TABLE public\.(messages|conversations|message_reactions)') {
    throw 'Fixture must grant SELECT by column for migration-owned tables.'
  }
  if ($fixture -match 'GRANT (INSERT|UPDATE) ON TABLE public\.message_reactions') {
    throw 'Fixture must grant reaction INSERT/UPDATE by column.'
  }
  foreach ($required in @(
    'GRANT SELECT \(id, message_id, conversation_id, actor_type, actor_id, emoji\)\s+ON TABLE public\.message_reactions',
    'GRANT INSERT \(message_id, conversation_id, actor_type, actor_id, emoji\)\s+ON TABLE public\.message_reactions',
    'GRANT UPDATE \(conversation_id, emoji\)\s+ON TABLE public\.message_reactions',
    'GRANT DELETE ON TABLE public\.message_reactions',
    'UNIQUE \(message_id, actor_type, actor_id\)'
  )) {
    if ($fixture -notmatch $required) { throw "Fixture is missing required grant/constraint: $required" }
  }
  foreach ($required in @(
    "requireRole\('agent'\)",
    'conversation\.account_id = \$2',
    'creator\.account_id = conversation\.account_id',
    'VALUES \(\$1, \$2, ''agent'', \$3, \$4\)',
    "reaction\.actor_type = 'agent'",
    'reaction\.actor_id = \$3'
  )) {
    if ($repository -notmatch $required) { throw "Repository is missing required guard: $required" }
  }
  if (-not (Test-Path -LiteralPath $integrationPath)) { throw 'Integration script is missing.' }

  New-Item -ItemType File -Path $taskLog | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Docker context: $dockerContext",
    "Command: docker run --pull=never -d --rm --name $databaseContainer --network none --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=384m -e POSTGRES_USER=db_message_reaction_bootstrap -e POSTGRES_PASSWORD=<synthetic-generated> -e POSTGRES_DB=postgres --mount <read-only-repository> $PostgresImage",
    "Disposable PostgreSQL image: $PostgresImage; database is tmpfs; no published ports or named volumes.",
    'Synthetic users, accounts, profiles, conversations, messages, and reactions only. Bootstrap and runtime passwords are generated for this run and are not recorded.',
    'PowerShell AST and fixture minimum-grant/forced-RLS checks passed.'
  )

  Invoke-DockerChecked @(
    'run', '--pull=never', '-d', '--rm', '--name', $databaseContainer, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', 'POSTGRES_USER=db_message_reaction_bootstrap',
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null
  $postgresImageId = (& docker image inspect --format '{{.Id}}' $PostgresImage).Trim()
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Disposable PostgreSQL image ID: $postgresImageId"

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U db_message_reaction_bootstrap -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_message_reaction_bootstrap', '-d', 'postgres', '-f',
    "/repo/.harness/tasks/$taskId/postgres-message-reaction-persistence-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_message_reaction_bootstrap', '-d', 'postgres', '-c',
    "ALTER ROLE wacrm_message_reaction_runtime PASSWORD '$runtimePassword'"
  ) | Out-Null

  $databaseUrl = "postgres://wacrm_message_reaction_runtime:$runtimePassword@127.0.0.1:5432/postgres"
  $nodeImageId = (& docker image inspect --format '{{.Id}}' $NodeImage).Trim()
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run --pull=never --rm --name $nodeContainer --network container:$databaseContainer --mount type=bind,source=$repoRoot,target=/source,readonly --workdir /source -e DATABASE_URL=postgres://wacrm_message_reaction_runtime:<synthetic-generated>@127.0.0.1:5432/postgres -e PG_POOL_MAX=4 $NodeImage node --conditions=react-server --import ./scripts/testing/register-typescript-extensionless-loader.mjs --experimental-strip-types --experimental-default-type=module scripts/testing/postgres-message-reaction-persistence-integration.mjs",
    "Disposable Node image ID: $nodeImageId"
  )

  $nodeArgs = @(
    'run', '--pull=never', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--workdir', '/source', '-e', "DATABASE_URL=$databaseUrl",
    '-e', 'TZ=Pacific/Kiritimati', '-e', 'PG_POOL_MAX=4',
    $NodeImage, 'node', '--conditions=react-server', '--import',
    './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    'scripts/testing/postgres-message-reaction-persistence-integration.mjs'
  )
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $nodeOutput = & docker @nodeArgs 2>&1
    $nodeExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Node integration exit code: $nodeExitCode"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value (@($nodeOutput | ForEach-Object { $_.ToString() }) -join "`n")
  if ($nodeExitCode -ne 0) { throw "PostgreSQL message-reaction persistence integration failed with exit $nodeExitCode." }

  $reactionProbe = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_message_reaction_bootstrap', '-d', 'postgres', '-c',
    "SELECT (SELECT count(*) FROM public.message_reactions WHERE message_id = '30000000-0000-4000-8000-000000000001' AND actor_type = 'customer')::text || ':' || (SELECT count(*) FROM public.message_reactions WHERE message_id = '30000000-0000-4000-8000-000000000001' AND actor_type = 'agent')::text || ':' || (SELECT count(*) FROM public.message_reactions WHERE message_id = '30000000-0000-4000-8000-000000000003')::text"
  )
  $reactionCounts = (@($reactionProbe | ForEach-Object { $_.ToString() }) -join '').Trim()
  if ($reactionCounts -ne '1:0:0') { throw "Reaction post-probe expected customer/agent/cross-account counts 1:0:0; found $reactionCounts." }
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Bootstrap post-probes passed: agent reaction was removed idempotently; existing customer reaction remained; cross-account message had no reaction.'
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Only synthetic fixtures were queried.'
  $validationSucceeded = $true
}
catch {
  $primaryFailure = $_.Exception.Message
  if (Test-Path -LiteralPath $taskLog) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Validation failure: $primaryFailure"
  }
}
finally {
  $ErrorActionPreference = 'Continue'
  $cleanupFailures = [System.Collections.Generic.List[string]]::new()
  foreach ($containerName in @($databaseContainer, $nodeContainer)) {
    $listedContainers = @(& docker ps -a --filter "name=$containerName" --format '{{.Names}}' 2>&1)
    $listExitCode = $LASTEXITCODE
    if ($listExitCode -ne 0) {
      $detail = @($listedContainers | ForEach-Object { $_.ToString() }) -join "`n"
      $cleanupFailures.Add("Could not inspect $containerName (exit $listExitCode): $detail")
      continue
    }
    if ($listedContainers -contains $containerName) {
      $removeOutput = @(& docker rm -f $containerName 2>&1)
      $removeExitCode = $LASTEXITCODE
      if ($removeExitCode -ne 0) {
        $detail = @($removeOutput | ForEach-Object { $_.ToString() }) -join "`n"
        $cleanupFailures.Add("Could not remove $containerName (exit $removeExitCode): $detail")
      }
    }
  }

  $residual = @(& docker ps -a --filter "name=$suffix" --format '{{.Names}}' 2>&1)
  $residualExitCode = $LASTEXITCODE
  if ($residualExitCode -ne 0) {
    $detail = @($residual | ForEach-Object { $_.ToString() }) -join "`n"
    $cleanupFailures.Add("Could not verify residual task containers (exit $residualExitCode): $detail")
  }
  elseif ($residual.Count -gt 0) {
    $cleanupFailures.Add("Residual task containers: $($residual -join ', ')")
  }

  $cleanup = if ($cleanupFailures.Count -eq 0) {
    'no residual task resources'
  } else {
    "cleanup failure: $($cleanupFailures -join '; ')"
  }
  if (Test-Path -LiteralPath $taskLog) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Cleanup: $cleanup"
  }
  if ($cleanupFailures.Count -gt 0) {
    $validationSucceeded = $false
    if ($primaryFailure) {
      $primaryFailure = "$primaryFailure; $cleanup"
    } else {
      $primaryFailure = $cleanup
    }
  }
}

if (-not $validationSucceeded) {
  if (Test-Path -LiteralPath $taskLog) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: FAILURE'
  }
  Write-Error "PostgreSQL message-reaction persistence validation failed: $primaryFailure"
  exit 1
}
Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
Write-Output "SUCCESS: PostgreSQL message-reaction persistence integration; log $taskLog"
exit 0
