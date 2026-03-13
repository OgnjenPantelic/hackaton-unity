# Security group rules (only created when creating new VPC)

resource "aws_vpc_security_group_egress_rule" "egress_ports" {
  for_each          = local.create_vpc ? { for port in local.egress_ports : tostring(port) => port } : {}
  security_group_id = local.security_group_id
  from_port         = each.value
  to_port           = each.value
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Allow outbound TCP on port ${each.value}"
}

resource "aws_vpc_security_group_egress_rule" "internal_tcp" {
  count                        = local.create_vpc ? 1 : 0
  security_group_id            = local.security_group_id
  referenced_security_group_id = local.security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 0
  to_port                      = 65535
  description                  = "Allow internal TCP"
}

resource "aws_vpc_security_group_egress_rule" "internal_udp" {
  count                        = local.create_vpc ? 1 : 0
  security_group_id            = local.security_group_id
  referenced_security_group_id = local.security_group_id
  ip_protocol                  = "udp"
  from_port                    = 0
  to_port                      = 65535
  description                  = "Allow internal UDP"
}

resource "aws_vpc_security_group_ingress_rule" "self" {
  count                        = local.create_vpc ? 1 : 0
  security_group_id            = local.security_group_id
  referenced_security_group_id = local.security_group_id
  ip_protocol                  = "-1"
  description                  = "Allow all from self"
}
