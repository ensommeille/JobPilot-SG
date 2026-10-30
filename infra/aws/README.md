# AWS course demo (CloudFormation)

This template provisions real AWS resources. It runs the existing application on
one Amazon Linux 2023 EC2 host, with container PostgreSQL and Redis. It is a
disposable course demonstration, with a single availability zone and no managed
database, automated backups, high availability, autoscaling or continuous delivery.

## Architecture and scope

- A dedicated VPC, subnet, internet gateway, route table, network interface and
  Elastic IP; existing account resources are not modified.
- One `t3.small` (2 vCPU, 2 GiB), standard CPU credits to avoid surplus-credit
  charges, 2 GiB swap and a 30 GiB encrypted gp3 root disk.
- Inbound TCP 80 (ACME/HTTPS redirect) and 443 (HTTPS) only. No SSH, database,
  Redis or direct backend port is published. SSM administers the instance through
  its own generated role with `AmazonSSMManagedInstanceCore`.
- Caddy obtains a publicly trusted certificate for `<elastic-ip>.sslip.io`.
  This demo depends on third-party sslip.io DNS and ACME availability. Use an
  owned domain and an appropriate operations design for a lasting service.
- `/api/*` proxies to FastAPI; all other paths serve the React SPA. Vite compiles
  `/api`, so remote browsers never contact their own localhost for API requests.
- The public GitHub repository is checked out at the exact `ApplicationCommit`.
  Compose and Buildx downloads have pinned versions and SHA-256 checksums.
- Database, JWT and demo administrator secrets are generated on the instance in
  `/opt/jobpilot/.env` with mode 600. They are absent from Git and template
  parameters. No model-provider key is copied from the local development setup.
  The scheduler is not started; the extension requires explicit later pairing.
- CloudFormation waits for the bootstrap's HTTPS API and frontend checks before
  marking this new stack complete. Infrastructure creation alone is insufficient.

## Cost

On 30 October 2026, the AWS Singapore on-demand price list gives Linux
`t3.small` at **US$0.0264/hour** and gp3 at **US$0.096/GiB-month**.
One public IPv4 address adds **US$0.005/hour**. At 730 hours/month, the baseline is
about **US$0.03535/hour, US$0.85/day or US$25.80/month**, before traffic, tax,
snapshots and any credit/free-tier deductions. This is an estimate, not a cap.
Stopping EC2 alone leaves disk and Elastic IP charges. No paid NAT gateway,
load balancer, domain registration or managed database is provisioned.

Sources: [AWS Singapore EC2 price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-southeast-1/index.json),
[AWS public IPv4 pricing](https://aws.amazon.com/vpc/pricing/).

## Create a fresh demo

Use AWS CLI v2 and an authorized account. `aws login --profile jobpilot-course`
can reuse an existing console login with temporary credentials; do not create
long-lived root access keys. Select Singapore (`ap-southeast-1`).

From the repository root, with that profile and region selected:

```sh
aws cloudformation validate-template --template-body file://infra/aws/cloudformation.yaml
aws cloudformation create-change-set --stack-name jobpilot-sg-demo \
  --change-set-name reviewed-demo --change-set-type CREATE \
  --template-body file://infra/aws/cloudformation.yaml --capabilities CAPABILITY_IAM
aws cloudformation wait change-set-create-complete \
  --stack-name jobpilot-sg-demo --change-set-name reviewed-demo
aws cloudformation describe-change-set --stack-name jobpilot-sg-demo --change-set-name reviewed-demo
# Inspect the additions and costs, then execute the reviewed change set.
aws cloudformation execute-change-set --stack-name jobpilot-sg-demo --change-set-name reviewed-demo
aws cloudformation wait stack-create-complete --stack-name jobpilot-sg-demo
aws cloudformation describe-stacks --stack-name jobpilot-sg-demo --query 'Stacks[0].Outputs'
```

Bootstrap can take several minutes to install Docker, build both images, migrate,
seed synthetic sandbox jobs and obtain TLS. Diagnose with SSM and
`/var/log/jobpilot-bootstrap.log`; never publish `.env`, the full user data with
its signed signal URL, tokens or authentication caches.

This bootstrap is intended for **fresh CREATE operations**. Updating UserData or
`ApplicationCommit` on an existing instance does not rerun cloud-init. Use a fresh
demo stack to reproduce a different commit. A persistent deployment needs a
separate application-update and data-migration procedure.

## Verify and administer

```sh
python scripts/verify_cloud_deployment.py --base-url https://YOUR-IP.sslip.io \
  --allow-test-writes --output output/cloud-smoke.json
aws ssm start-session --target INSTANCE_ID --region ap-southeast-1
```

The smoke check creates two clearly synthetic accounts, keeps credentials in
memory, and verifies HTTPS, the compiled frontend, jobs, authentication and
profile isolation. These synthetic records remain in the demo database. It does
not contact employers or call an LLM. The previous local acceptance scripts keep
their loopback-only safety rules.

Inside an authorized SSM session, run `sudo -i`, then `cd /opt/jobpilot` and
`docker compose ps`. Admin email is `admin@jobpilot.sg`; an operator can privately
read its generated password from `.env`. Do not paste the file into reports.

## Teardown and data

PostgreSQL and Caddy state live in named Docker volumes on the encrypted EC2 root
disk and survive container/host restarts. They are **deleted when this demo stack
is deleted**. Export any required data first and obtain explicit authorization
before teardown. For an authorized disposable stack:

```sh
aws cloudformation delete-stack --stack-name jobpilot-sg-demo
aws cloudformation wait stack-delete-complete --stack-name jobpilot-sg-demo
```

CloudFormation removes the generated role/profile, EC2 disk, IP and network.
Check the final stack status and account resources; do not assume deletion merely
because the command was accepted. Stack deletion has not been exercised on the
live demonstration unless its evidence explicitly says so.
