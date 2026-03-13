//! Shared AES-256-GCM encryption utilities for secrets stored at rest.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::Engine;
use rand::RngCore;

const ENC_PREFIX: &str = "enc:v1:";

/// Returns `true` if the value has the encrypted-at-rest prefix.
pub fn is_encrypted(value: &str) -> bool {
    value.starts_with(ENC_PREFIX)
}

/// Encrypt a plaintext string using AES-256-GCM with a random nonce.
/// The output is `enc:v1:<base64(nonce ++ ciphertext)>`.
pub fn encrypt(plaintext: &str, enc_key: &[u8; 32]) -> Result<String, String> {
    let cipher = Aes256Gcm::new(enc_key.into());
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let mut combined = nonce_bytes.to_vec();
    combined.extend_from_slice(&ciphertext);
    let encoded = base64::engine::general_purpose::STANDARD.encode(&combined);
    Ok(format!("{}{}", ENC_PREFIX, encoded))
}

/// Decrypt a value previously produced by [`encrypt`].
pub fn decrypt(encrypted: &str, enc_key: &[u8; 32]) -> Result<String, String> {
    let cipher = Aes256Gcm::new(enc_key.into());

    let encoded = encrypted
        .strip_prefix(ENC_PREFIX)
        .ok_or_else(|| "Invalid encrypted value: missing prefix".to_string())?;

    let combined = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Invalid encrypted value: {}", e))?;

    if combined.len() < 12 {
        return Err("Invalid encrypted value: too short".to_string());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))?;

    String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8 in decrypted value: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::RngCore;

    fn random_key() -> [u8; 32] {
        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);
        key
    }

    #[test]
    fn round_trip() {
        let key = random_key();
        let plaintext = "super-secret-value";
        let encrypted = encrypt(plaintext, &key).unwrap();
        assert!(is_encrypted(&encrypted));
        assert_eq!(decrypt(&encrypted, &key).unwrap(), plaintext);
    }

    #[test]
    fn different_nonces_each_time() {
        let key = random_key();
        let enc1 = encrypt("same", &key).unwrap();
        let enc2 = encrypt("same", &key).unwrap();
        assert_ne!(enc1, enc2);
        assert_eq!(decrypt(&enc1, &key).unwrap(), "same");
        assert_eq!(decrypt(&enc2, &key).unwrap(), "same");
    }

    #[test]
    fn wrong_key_fails() {
        let encrypted = encrypt("secret", &random_key()).unwrap();
        assert!(decrypt(&encrypted, &random_key()).is_err());
    }

    #[test]
    fn invalid_prefix_fails() {
        assert!(decrypt("not-encrypted", &random_key()).is_err());
    }

    #[test]
    fn invalid_base64_fails() {
        assert!(decrypt("enc:v1:not-valid-base64!!!", &random_key()).is_err());
    }

    #[test]
    fn too_short_fails() {
        let short = format!("enc:v1:{}", base64::engine::general_purpose::STANDARD.encode(&[0u8; 5]));
        assert!(decrypt(&short, &random_key()).is_err());
    }

    #[test]
    fn is_encrypted_checks() {
        assert!(is_encrypted("enc:v1:somebase64data"));
        assert!(!is_encrypted("sk-1234567890abcdef"));
        assert!(!is_encrypted(""));
        assert!(!is_encrypted("enc:v2:data"));
    }
}
