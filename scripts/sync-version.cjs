#!/usr/bin/env node

/**
 * Sync version from package.json to Cargo.toml and tauri.conf.json
 * This script runs automatically when `npm version` is executed
 */

const fs = require('fs');
const path = require('path');

// Paths
const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'package.json');
const CARGO_TOML_PATH = path.join(__dirname, '..', 'src-tauri', 'Cargo.toml');
const TAURI_CONF_PATH = path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json');

function main() {
  try {
    // Read version from package.json
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    const version = packageJson.version;
    
    if (!version) {
      console.error('❌ Error: No version found in package.json');
      process.exit(1);
    }
    
    console.log(`📦 Syncing version ${version} to all config files...`);
    
    // Update Cargo.toml
    updateCargoToml(version);
    
    // Update tauri.conf.json
    updateTauriConf(version);
    
    console.log('✅ Version sync complete!');
    console.log(`   - package.json: ${version}`);
    console.log(`   - Cargo.toml: ${version}`);
    console.log(`   - tauri.conf.json: ${version}`);
    
  } catch (error) {
    console.error('❌ Error syncing version:', error.message);
    process.exit(1);
  }
}

function updateCargoToml(version) {
  let content = fs.readFileSync(CARGO_TOML_PATH, 'utf8');
  
  // Update version in [package] section
  // Match: version = "any.version.here"
  const versionRegex = /^version\s*=\s*"[^"]*"/m;
  
  if (!versionRegex.test(content)) {
    throw new Error('Could not find version field in Cargo.toml');
  }
  
  content = content.replace(versionRegex, `version = "${version}"`);
  fs.writeFileSync(CARGO_TOML_PATH, content, 'utf8');
}

function updateTauriConf(version) {
  const content = fs.readFileSync(TAURI_CONF_PATH, 'utf8');
  const config = JSON.parse(content);
  
  config.version = version;
  
  // Write with 2-space indentation to match existing format
  fs.writeFileSync(TAURI_CONF_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

// Run the script
main();
