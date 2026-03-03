data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  availability_zones = slice(data.aws_availability_zones.available.names, 0, 2)
  vpc_prefix         = tonumber(split("/", var.cidr_block)[1])

  # Auto-computed defaults: private subnets = VPC/4, public subnet = /28
  nat_newbits = 28 - local.vpc_prefix

  private_subnets = [
    coalesce(var.private_subnet_1_cidr, cidrsubnet(var.cidr_block, 2, 0)),
    coalesce(var.private_subnet_2_cidr, cidrsubnet(var.cidr_block, 2, 1)),
  ]

  public_subnets = [
    coalesce(var.public_subnet_cidr, cidrsubnet(var.cidr_block, local.nat_newbits, pow(2, local.nat_newbits - 1))),
  ]

  egress_ports = [443, 3306, 6666, 8443, 8444, 8445, 8446, 8447, 8448, 8449, 8450, 8451]
}
