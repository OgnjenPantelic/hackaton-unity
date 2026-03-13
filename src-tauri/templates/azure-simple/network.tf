# Determine if VNet resource group is different from main resource group
locals {
  network_prefix               = var.workspace_name
  vnet_rg_is_same_as_main      = var.vnet_resource_group_name == var.resource_group_name
  create_separate_vnet_rg      = var.create_new_vnet && !local.vnet_rg_is_same_as_main
}

# new VNet resources
resource "azurerm_virtual_network" "this" {
  count               = var.create_new_vnet ? 1 : 0
  name                = "${local.network_prefix}-vnet"
  location            = local.resource_group.location
  resource_group_name = var.vnet_resource_group_name
  address_space       = [var.cidr]
  tags                = var.tags
  depends_on          = [azurerm_resource_group.vnet_resource_group]
}

# Only create a separate VNet resource group if it's different from the main one
resource "azurerm_resource_group" "vnet_resource_group" {
  count    = local.create_separate_vnet_rg ? 1 : 0
  name     = var.vnet_resource_group_name
  location = local.resource_group.location
}

#existing VNet resources
data "azurerm_virtual_network" "existing" {
  count               = var.create_new_vnet ? 0 : 1
  name                = var.vnet_name
  resource_group_name = var.vnet_resource_group_name
}

data "azurerm_resource_group" "existing_vnet_resource_group" {
  count = var.create_new_vnet ? 0 : 1
  name  = var.vnet_resource_group_name
}

locals {
  # Use the main resource group if VNet RG is the same, otherwise use the separate one
  vnet = var.create_new_vnet ? azurerm_virtual_network.this[0] : data.azurerm_virtual_network.existing[0]
  vnet_resource_group = var.create_new_vnet ? (
    local.vnet_rg_is_same_as_main ? local.resource_group : azurerm_resource_group.vnet_resource_group[0]
  ) : data.azurerm_resource_group.existing_vnet_resource_group[0]
}

# other network resources

resource "azurerm_network_security_group" "this" {
  name                = "${local.network_prefix}-nsg"
  location            = local.vnet.location
  resource_group_name = local.vnet_resource_group.name
  tags                = var.tags
}

resource "azurerm_subnet" "public" {
  name                 = "${local.network_prefix}-public-subnet"
  resource_group_name  = local.vnet_resource_group.name
  virtual_network_name = local.vnet.name
  address_prefixes     = [var.subnet_public_cidr]
  default_outbound_access_enabled = false

  delegation {
    name = "databricks"
    service_delegation {
      name = "Microsoft.Databricks/workspaces"
      actions = [
        "Microsoft.Network/virtualNetworks/subnets/join/action",
        "Microsoft.Network/virtualNetworks/subnets/prepareNetworkPolicies/action",
        "Microsoft.Network/virtualNetworks/subnets/unprepareNetworkPolicies/action"]
    }
  }
}

resource "azurerm_subnet_network_security_group_association" "public" {
  subnet_id                 = azurerm_subnet.public.id
  network_security_group_id = azurerm_network_security_group.this.id
}

resource "azurerm_subnet" "private" {
  name                 = "${local.network_prefix}-private-subnet"
  resource_group_name  = local.vnet_resource_group.name
  virtual_network_name = local.vnet.name
  address_prefixes     = [var.subnet_private_cidr]
  default_outbound_access_enabled = false

  delegation {
    name = "databricks"
    service_delegation {
      name = "Microsoft.Databricks/workspaces"
      actions = [
        "Microsoft.Network/virtualNetworks/subnets/join/action",
        "Microsoft.Network/virtualNetworks/subnets/prepareNetworkPolicies/action",
        "Microsoft.Network/virtualNetworks/subnets/unprepareNetworkPolicies/action"]
    }
  }
}

resource "azurerm_subnet_network_security_group_association" "private" {
  subnet_id                 = azurerm_subnet.private.id
  network_security_group_id = azurerm_network_security_group.this.id
}

# NAT Gateway resources

resource "azurerm_public_ip" "this" {
  name                = "${local.network_prefix}-public-ip"
  resource_group_name = local.vnet_resource_group.name
  location            = local.vnet.location
  allocation_method   = "Static"
  tags                = var.tags
}

resource "azurerm_nat_gateway" "this" {
  name                = "${local.network_prefix}-nat-gateway"
  resource_group_name = local.vnet_resource_group.name
  location            = local.vnet.location
  sku_name            = "Standard"
  idle_timeout_in_minutes = 10
  tags                = var.tags
}

resource "azurerm_nat_gateway_public_ip_association" "this" {
  nat_gateway_id       = azurerm_nat_gateway.this.id
  public_ip_address_id = azurerm_public_ip.this.id
}

resource "azurerm_subnet_nat_gateway_association" "public_nat_gateway_association" {
  subnet_id      = azurerm_subnet.public.id
  nat_gateway_id = azurerm_nat_gateway.this.id
}

resource "azurerm_subnet_nat_gateway_association" "private_nat_gateway_association" {
  subnet_id      = azurerm_subnet.private.id
  nat_gateway_id = azurerm_nat_gateway.this.id
}
