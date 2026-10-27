param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskId = '20261020-123450-7a32'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-pending-claim-tenant-db-$suffix"
$nodeContainer = "wacrm-pending-claim-tenant-node-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$fixturePath = Join-Path $repoRoot ".harness/tasks/$taskId/postgres-automation-pending-claim-tenant-fixture.sql"
$integrationPath = Join-Path $repoRoot 'scripts/testing/postgres-automation-pending-claim-tenant-integration.mjs'
$repositoryPath = Join-Path $repoRoot 'src/lib/repositories/automation-pending-claim.ts'
$taskLog = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ".harness/tasks/$taskId/validation-postgres-automation-pending-claim-tenant-$suffix.log"))
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
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    $PSCommandPath,
    [ref]$null,
    [ref]$parseErrors
  ) | Out-Null
  if ($parseErrors.Count -gt 0) {
    throw "PowerShell AST parse failed: $($parseErrors -join '; ')"
  }

  $dockerOs = (& docker info --format '{{.OperatingSystem}}' 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $dockerOs -notmatch 'Docker Desktop') {
    throw "Docker Desktop is required for this disposable validation; detected: $dockerOs"
  }

  $fixture = Get-Content -LiteralPath $fixturePath -Raw
  foreach ($requirement in @(
    'CREATE ROLE wacrm_automation_pending_claim_tenant_job\s+LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
    'ALTER TABLE public\.automation_pending_executions ENABLE ROW LEVEL SECURITY;\s*ALTER TABLE public\.automation_pending_executions FORCE ROW LEVEL SECURITY;',
    'CREATE POLICY automation_pending_claim_tenant_select\s+ON public\.automation_pending_executions\s+FOR SELECT',
    'CREATE POLICY automation_pending_claim_tenant_update\s+ON public\.automation_pending_executions\s+FOR UPDATE',
    'USING \(\s*public\.is_account_member\(account_id, ''agent''\)\s+AND status = ''pending''\s*\)',
    'WITH CHECK \(\s*public\.is_account_member\(account_id, ''agent''\)\s+AND status = ''running''\s*\)',
    'GRANT UPDATE \(status\)',
    "private_payload text NOT NULL DEFAULT 'SYNTHETIC_PRIVATE_PAYLOAD'",
    'generate_series\(101, 110\)'
  )) {
    if ($fixture -notmatch $requirement) {
      throw "Tenant fixture is missing required RLS/grant/seed pattern: $requirement"
    }
  }

  $repository = Get-Content -LiteralPath $repositoryPath -Raw
  foreach ($requirement in @(
    'set_config\(''request\.jwt\.claim\.sub'', \$1, true\)',
    'WHERE account_id = \$1\s+AND status = ''pending''\s+AND run_at <= \$2',
    'LIMIT \$3\s+FOR UPDATE SKIP LOCKED',
    'pending\.account_id = \$1',
    '\[writerContext\.accountId, asOf, limit\]'
  )) {
    if ($repository -notmatch $requirement) {
      throw "Repository is missing tenant-scoped claim pattern: $requirement"
    }
  }

  $integration = Get-Content -LiteralPath $integrationPath -Raw
  foreach ($requiredText in @(
    'viewerA',
    'nonmemberA',
    'transaction-local identity cleanup',
    'private_payload',
    'SKIP LOCKED',
    'concurrentClaims',
    'row.user_id'
  )) {
    if ($integration -notmatch [regex]::Escape($requiredText)) {
      throw "Tenant integration is missing required probe: $requiredText"
    }
  }
  Write-Output 'PowerShell AST, Docker Desktop, account predicates, forced-RLS fixture, minimum-grant and integration-probe checks passed.'

  New-Item -ItemType File -Path $taskLog | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run -d --rm --name $databaseContainer --network none --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=384m -e POSTGRES_USER=pending_claim_tenant_bootstrap -e POSTGRES_PASSWORD=<synthetic-generated> -e POSTGRES_DB=postgres --mount <read-only-repository> $PostgresImage",
    "Disposable PostgreSQL image: $PostgresImage; database is tmpfs; no published ports or named volumes.",
    'Synthetic tenants/executions only. Bootstrap/runtime credentials are generated and are not recorded.'
  )

  Invoke-DockerChecked @('pull', $NodeImage) | Out-Null
  Invoke-DockerChecked @(
    'run', '-d', '--rm', '--name', $databaseContainer, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', 'POSTGRES_USER=pending_claim_tenant_bootstrap',
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "PostgreSQL image ID: $(& docker image inspect --format '{{.Id}}' $PostgresImage)",
    "Node image ID: $(& docker image inspect --format '{{.Id}}' $NodeImage)"
  )

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U pending_claim_tenant_bootstrap -d postgres *> $null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'pending_claim_tenant_bootstrap', '-d', 'postgres', '-f',
    "/repo/.harness/tasks/$taskId/postgres-automation-pending-claim-tenant-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'pending_claim_tenant_bootstrap', '-d', 'postgres', '-c',
    "ALTER ROLE wacrm_automation_pending_claim_tenant_job PASSWORD '$runtimePassword'"
  ) | Out-Null

  $databaseUrl = "postgres://wacrm_automation_pending_claim_tenant_job:$runtimePassword@127.0.0.1:5432/postgres"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run --rm --name $nodeContainer --network container:$databaseContainer --mount type=bind,source=$repoRoot,target=/source,readonly --workdir /source -e DATABASE_URL=postgres://wacrm_automation_pending_claim_tenant_job:<synthetic-generated>@127.0.0.1:5432/postgres -e PG_POOL_MAX=8 $NodeImage node --conditions=react-server --import ./scripts/testing/register-typescript-extensionless-loader.mjs --experimental-strip-types --experimental-default-type=module scripts/testing/postgres-automation-pending-claim-tenant-integration.mjs",
    'Node container shares only the disposable database network namespace; repository mount is read-only.'
  )

  $nodeArgs = @(
    'run', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--workdir', '/source', '-e', "DATABASE_URL=$databaseUrl",
    '-e', 'PG_POOL_MAX=8', $NodeImage, 'node', '--conditions=react-server',
    '--import', './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    'scripts/testing/postgres-automation-pending-claim-tenant-integration.mjs'
  )
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $nodeOutput = & docker @nodeArgs 2>&1
    $nodeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Node integration exit code: $nodeExitCode"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value (@($nodeOutput | ForEach-Object { $_.ToString() }) -join "`n")
  if ($nodeExitCode -ne 0) {
    throw "PostgreSQL automation pending-claim tenant integration failed with exit $nodeExitCode."
  }

  $validationSucceeded = $true
} catch {
  $primaryFailure = $_.Exception.Message
  if (Test-Path -LiteralPath $taskLog) {
    Add-Content -LiteralPath $taskLog -Encoding utf8 -Value "Validation failure: $primaryFailure"
  }
} finally {
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
  } elseif ($residual.Count -gt 0) {
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
  Write-Error "PostgreSQL automation pending-claim tenant validation failed: $primaryFailure"
  exit 1
}

Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
Write-Output "SUCCESS: PostgreSQL automation pending-claim tenant integration; log $taskLog"
exit 0
