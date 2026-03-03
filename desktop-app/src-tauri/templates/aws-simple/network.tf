locals {
  create_vpc = var.create_new_vpc
}

module "vpc" {
  count   = local.create_vpc ? 1 : 0
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.1.1"

  name = "${var.prefix}-vpc"
  cidr = var.cidr_block
  azs  = local.availability_zones

  enable_dns_hostnames   = true
  enable_nat_gateway     = true
  single_nat_gateway     = true
  one_nat_gateway_per_az = false
  create_igw             = true

  private_subnet_names = [for az in local.availability_zones : "${var.prefix}-private-${az}"]
  private_subnets      = local.private_subnets

  public_subnet_names = ["${var.prefix}-public-nat"]
  public_subnets      = local.public_subnets

  tags = var.tags
}

# Create dedicated security group for Databricks (when creating VPC)
resource "aws_security_group" "databricks" {
  count       = local.create_vpc ? 1 : 0
  name        = "${var.prefix}-databricks-sg"
  description = "Security group for Databricks workspace"
  vpc_id      = module.vpc[0].vpc_id
  tags        = merge(var.tags, { Name = "${var.prefix}-databricks-sg" })
}

# Resolved values (created or existing)
locals {
  vpc_id             = local.create_vpc ? module.vpc[0].vpc_id : var.existing_vpc_id
  subnet_ids         = local.create_vpc ? module.vpc[0].private_subnets : var.existing_subnet_ids
  security_group_id  = local.create_vpc ? aws_security_group.databricks[0].id : var.existing_security_group_id
}
