param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskId = '20261019-215941-005d'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-account-members-db-$suffix"
$nodeContainer = "wacrm-account-members-node-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$taskLog = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../.harness/tasks/$taskId/validation-postgres-account-members-$suffix.log"))
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
  New-Item -ItemType File -Path $taskLog | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run -d --rm --name $databaseContainer --network none --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=384m -e POSTGRES_USER=db_members_bootstrap -e POSTGRES_PASSWORD=<synthetic-generated> -e POSTGRES_DB=postgres --mount <read-only-repository> $PostgresImage",
    "Disposable PostgreSQL image: $PostgresImage; database is tmpfs; no published ports or named volumes.",
    'Synthetic accounts/users only. Bootstrap and runtime passwords are generated for this run and are not recorded.'
  )

  Invoke-DockerChecked @(
    'run', '-d', '--rm', '--name', $databaseContainer, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', 'POSTGRES_USER=db_members_bootstrap',
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Disposable PostgreSQL image ID: $(& docker image inspect --format '{{.Id}}' $PostgresImage)"

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U db_members_bootstrap -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_members_bootstrap', '-d', 'postgres', '-f',
    "/repo/.harness/tasks/$taskId/postgres-account-members-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'db_members_bootstrap', '-d', 'postgres', '-c',
    "ALTER ROLE wacrm_account_members_runtime PASSWORD '$runtimePassword'"
  ) | Out-Null

  $databaseUrl = "postgres://wacrm_account_members_runtime:$runtimePassword@127.0.0.1:5432/postgres"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run --rm --name $nodeContainer --network container:$databaseContainer --mount type=bind,source=$repoRoot,target=/source,readonly --workdir /source -e DATABASE_URL=postgres://wacrm_account_members_runtime:<synthetic-generated>@127.0.0.1:5432/postgres $NodeImage node --conditions=react-server --import ./scripts/testing/register-typescript-extensionless-loader.mjs --experimental-strip-types --experimental-default-type=module scripts/testing/postgres-account-members-integration.mjs",
    "Disposable Node image ID: $(& docker image inspect --format '{{.Id}}' $NodeImage)"
  )

  $nodeArgs = @(
    'run', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--workdir', '/source', '-e', "DATABASE_URL=$databaseUrl",
    $NodeImage, 'node', '--conditions=react-server', '--import',
    './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    'scripts/testing/postgres-account-members-integration.mjs'
  )
  $nodeOutput = & docker @nodeArgs 2>&1
  $nodeExitCode = $LASTEXITCODE
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Node integration exit code: $nodeExitCode"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value (@($nodeOutput | ForEach-Object { $_.ToString() }) -join "`n")
  if ($nodeExitCode -ne 0) { throw "Node PostgreSQL account-members integration failed with exit $nodeExitCode." }

  $validationSucceeded = $true
}
catch {
  $primaryFailure = $_.Exception.Message
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Validation failure: $primaryFailure"
}
finally {
  $ErrorActionPreference = 'Continue'
  & docker rm -f $databaseContainer 2>&1 | Out-Null
  & docker rm -f $nodeContainer 2>&1 | Out-Null
  $residual = @(& docker ps -a --filter "name=$suffix" --format '{{.Names}}' 2>$null)
  $cleanup = if ($residual.Count -eq 0) { 'no residual task resources' } else { "residual containers: $($residual -join ', ')" }
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Cleanup: $cleanup"
}

if (-not $validationSucceeded) {
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: FAILURE'
  Write-Error "PostgreSQL account-members validation failed: $primaryFailure"
  exit 1
}
Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
Write-Output "SUCCESS: PostgreSQL account-members integration; log $taskLog"
exit 0
