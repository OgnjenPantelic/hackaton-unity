# Create resource group only if it doesn't already exist
# The variable create_new_resource_group controls this behavior
resource "azurerm_resource_group" "this" {
  count    = var.create_new_resource_group ? 1 : 0
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}

# Reference existing resource group if not creating new one
data "azurerm_resource_group" "existing" {
  count = var.create_new_resource_group ? 0 : 1
  name  = var.resource_group_name
}

locals {
  resource_group = var.create_new_resource_group ? azurerm_resource_group.this[0] : data.azurerm_resource_group.existing[0]
}