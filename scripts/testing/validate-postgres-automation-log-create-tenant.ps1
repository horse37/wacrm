param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$NodeImage = 'node:22-bookworm'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskId = '20261020-114016-71ea'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "wacrm-automation-log-create-tenant-db-$suffix"
$nodeContainer = "wacrm-automation-log-create-tenant-node-$suffix"
$bootstrapPassword = [guid]::NewGuid().ToString('N')
$runtimePassword = [guid]::NewGuid().ToString('N')
$fixturePath = Join-Path $repoRoot ".harness/tasks/$taskId/postgres-automation-log-create-tenant-fixture.sql"
$integrationPath = Join-Path $repoRoot 'scripts/testing/postgres-automation-log-create-tenant-integration.mjs'
$taskLog = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ".harness/tasks/$taskId/validation-postgres-automation-log-create-tenant-$suffix.log"))
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

  $fixture = Get-Content -LiteralPath $fixturePath -Raw
  $fixtureRequirements = @(
    'CREATE ROLE wacrm_automation_log_create_tenant_job\s+LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
  'ALTER TABLE public\.automation_logs ENABLE ROW LEVEL SECURITY;\s*ALTER TABLE public\.automation_logs FORCE ROW LEVEL SECURITY;',
  'CREATE POLICY automation_log_create_tenant_insert\s+ON public\.automation_logs\s+FOR INSERT\s+TO wacrm_automation_log_create_tenant_job',
  'WITH CHECK \(\s*public\.is_account_member\(account_id, ''agent''\)\s+AND user_id = public\.wacrm_request_user_id\(\)\s*\)',
  'REVOKE ALL ON FUNCTION public\.wacrm_request_user_id\(\) FROM PUBLIC',
  'REVOKE ALL ON FUNCTION public\.is_account_member',
  'GRANT EXECUTE ON FUNCTION public\.wacrm_request_user_id\(\)',
  'GRANT EXECUTE ON FUNCTION public\.is_account_member',
  'GRANT INSERT \('
)
  foreach ($requirement in $fixtureRequirements) {
    if ($fixture -notmatch $requirement) {
      throw "Tenant fixture is missing required RLS/grant pattern: $requirement"
    }
  }

  $integration = Get-Content -LiteralPath $integrationPath -Raw
  foreach ($requiredText in @(
  'assertRlsDeniesInsert',
  'otherOwnerA',
  'writerB',
  'viewerA',
  'private-column protection',
  'transaction-local identity cleanup'
)) {
    if ($integration -notmatch [regex]::Escape($requiredText)) {
      throw "Tenant integration is missing required probe: $requiredText"
    }
  }
  Write-Output 'PowerShell AST, fixture tenant RLS, NOBYPASSRLS, and minimum-grant checks passed.'

  New-Item -ItemType File -Path $taskLog | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run -d --rm --name $databaseContainer --network none --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=384m -e POSTGRES_USER=automation_log_create_tenant_bootstrap -e POSTGRES_PASSWORD=<synthetic-generated> -e POSTGRES_DB=postgres --mount <read-only-repository> $PostgresImage",
    "Disposable PostgreSQL image: $PostgresImage; database is tmpfs; no published ports or named volumes.",
    'Synthetic tenants/logs only. Bootstrap/runtime passwords are randomly generated and are not recorded.'
  )

  Invoke-DockerChecked @('pull', $NodeImage) | Out-Null
  Invoke-DockerChecked @(
    'run', '-d', '--rm', '--name', $databaseContainer, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=384m',
    '--mount', "type=bind,source=$repoRoot,target=/repo,readonly",
    '-e', 'POSTGRES_USER=automation_log_create_tenant_bootstrap',
    '-e', "POSTGRES_PASSWORD=$bootstrapPassword",
    '-e', 'POSTGRES_DB=postgres', $PostgresImage
  ) | Out-Null
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "PostgreSQL image ID: $(& docker image inspect --format '{{.Id}}' $PostgresImage)",
    "Node image ID: $(& docker image inspect --format '{{.Id}}' $NodeImage)"
  )

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $databaseContainer pg_isready -U automation_log_create_tenant_bootstrap -d postgres *> $null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw 'Disposable PostgreSQL did not become ready.'
  }

  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'automation_log_create_tenant_bootstrap', '-d', 'postgres', '-f',
    "/repo/.harness/tasks/$taskId/postgres-automation-log-create-tenant-fixture.sql"
  ) | Out-Null
  Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'automation_log_create_tenant_bootstrap', '-d', 'postgres', '-c',
    "ALTER ROLE wacrm_automation_log_create_tenant_job PASSWORD '$runtimePassword'"
  ) | Out-Null

  $databaseUrl = "postgres://wacrm_automation_log_create_tenant_job:$runtimePassword@127.0.0.1:5432/postgres"
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value @(
    "Command: docker run --rm --name $nodeContainer --network container:$databaseContainer --mount type=bind,source=$repoRoot,target=/source,readonly --workdir /source -e DATABASE_URL=postgres://wacrm_automation_log_create_tenant_job:<synthetic-generated>@127.0.0.1:5432/postgres -e PG_POOL_MAX=1 $NodeImage node --conditions=react-server --import ./scripts/testing/register-typescript-extensionless-loader.mjs --experimental-strip-types --experimental-default-type=module scripts/testing/postgres-automation-log-create-tenant-integration.mjs",
    'Node container shares only the disposable database network namespace; repository mount is read-only.'
  )
  $nodeArgs = @(
    'run', '--rm', '--name', $nodeContainer,
    '--network', "container:$databaseContainer",
    '--mount', "type=bind,source=$repoRoot,target=/source,readonly",
    '--workdir', '/source', '-e', "DATABASE_URL=$databaseUrl",
    '-e', 'PG_POOL_MAX=1', $NodeImage, 'node', '--conditions=react-server',
    '--import', './scripts/testing/register-typescript-extensionless-loader.mjs',
    '--experimental-strip-types', '--experimental-default-type=module',
    'scripts/testing/postgres-automation-log-create-tenant-integration.mjs'
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
    throw "Tenant-scoped PostgreSQL automation-log finalize integration failed with exit $nodeExitCode."
  }

  $auditSql = @'
DO $$
BEGIN
  IF (SELECT count(*) FROM public.automation_logs) <> 3 THEN
    RAISE EXCEPTION 'expected exactly three accepted synthetic logs';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.automation_logs
    WHERE account_id <> '10000000-0000-4000-8000-000000000001'
       OR user_id <> '00000000-0000-4000-8000-000000000001'
  ) THEN RAISE EXCEPTION 'tenant or owner identity came from untrusted payload'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_logs
    WHERE automation_id = '30000000-0000-4000-8000-000000000001'
      AND account_id = '10000000-0000-4000-8000-000000000001'
      AND user_id = '00000000-0000-4000-8000-000000000001'
      AND contact_id = '50000000-0000-4000-8000-000000000001'
      AND trigger_event = 'new_message_received'
      AND steps_executed = '[]'::jsonb
      AND status = 'success'
      AND private_payload = 'SYNTHETIC_PRIVATE_PAYLOAD'
  ) THEN RAISE EXCEPTION 'contactful initial log did not match trusted context and input'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_logs
    WHERE automation_id = '30000000-0000-4000-8000-000000000001'
      AND account_id = '10000000-0000-4000-8000-000000000001'
      AND user_id = '00000000-0000-4000-8000-000000000001'
      AND contact_id IS NULL
      AND trigger_event = 'first_inbound_message'
      AND steps_executed = '[]'::jsonb
      AND status = 'success'
      AND private_payload = 'SYNTHETIC_PRIVATE_PAYLOAD'
  ) THEN RAISE EXCEPTION 'contactless initial log did not match trusted context and input'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.automation_logs
    WHERE automation_id = '30000000-0000-4000-8000-000000000002'
       OR account_id = '10000000-0000-4000-8000-000000000002'
       OR user_id = '00000000-0000-4000-8000-000000000003'
       OR user_id = '00000000-0000-4000-8000-000000000004'
  ) THEN RAISE EXCEPTION 'denied or constraint-rejected insert persisted'; END IF;
END
$$;
'@
  $auditOutput = Invoke-DockerChecked @(
    'exec', $databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'automation_log_create_tenant_bootstrap', '-d', 'postgres', '-c', $auditSql
  )
Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Bootstrap-only stored-row audit: PASS (exactly three accepted trusted-context logs; no denied or constraint-rejected row persisted; contactful/contactless inputs, initial success, empty steps, and private payload preserved).'
  Add-Content -LiteralPath $taskLog -Encoding utf8 -Value (@($auditOutput | ForEach-Object { $_.ToString() }) -join "`n")
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
  Write-Error "PostgreSQL automation-log create tenant validation failed: $primaryFailure"
  exit 1
}

Add-Content -LiteralPath $taskLog -Encoding utf8 -Value 'Overall result: SUCCESS'
Write-Output "SUCCESS: PostgreSQL automation-log create tenant integration; log $taskLog"
exit 0
