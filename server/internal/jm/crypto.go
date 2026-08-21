package jm

import (
	"crypto/aes"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"errors"
)

const (
	TokenSecret        = "185Hcomic3PAPP7R"
	ContentTokenSecret = "18comicAPPContent"
	DataSecret         = "185Hcomic3PAPP7R"
	DomainServerSecret = "diosfjckwpqpdfjkvnqQjsik"
	AppVersion         = "2.0.30"

	UserAgent = "Mozilla/5.0 (Linux; Android 9; V1938CT Build/PQ3A.190705.11211812; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36"
)

var DefaultAPIDomains = []string{
	"www.cdnhjk.net",
	"www.cdngwc.cc",
	"www.cdngwc.net",
	"www.cdngwc.club",
}

var DefaultImageDomains = []string{
	"cdn-msp.jmapiproxy1.cc",
	"cdn-msp.jmapiproxy2.cc",
	"cdn-msp2.jmapiproxy2.cc",
	"cdn-msp3.jmapiproxy2.cc",
	"cdn-msp.jmapinodeudzn.net",
	"cdn-msp3.jmapinodeudzn.net",
}

var DomainServerList = []string{
	"https://rup4a04-c01.tos-ap-southeast-1.bytepluses.com/newsvr-2025.txt",
	"https://rup4a04-c02.tos-cn-hongkong.bytepluses.com/newsvr-2025.txt",
	"https://rup4a04-c03.tos-cn-beijing.bytepluses.com.cn/newsvr-2025.txt",
}

func MD5Hex(s string) string {
	sum := md5.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}

func TokenAndTokenParam(ts, secret string) (string, string) {
	if secret == "" {
		secret = TokenSecret
	}
	return MD5Hex(ts + secret), ts + "," + AppVersion
}

func DecryptRespData(dataB64, ts, secret string) ([]byte, error) {
	if secret == "" {
		secret = DataSecret
	}
	raw, err := base64.StdEncoding.DecodeString(dataB64)
	if err != nil {
		return nil, err
	}
	key := []byte(MD5Hex(ts + secret))
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 || len(raw)%aes.BlockSize != 0 {
		return nil, errors.New("jm: invalid ciphertext length")
	}
	out := make([]byte, len(raw))
	for i := 0; i < len(raw); i += aes.BlockSize {
		block.Decrypt(out[i:i+aes.BlockSize], raw[i:i+aes.BlockSize])
	}
	pad := int(out[len(out)-1])
	if pad <= 0 || pad > aes.BlockSize || pad > len(out) {
		return nil, errors.New("jm: bad padding")
	}
	for _, b := range out[len(out)-pad:] {
		if int(b) != pad {
			return nil, errors.New("jm: bad padding")
		}
	}
	return out[:len(out)-pad], nil
}

func EncryptRespData(plain []byte, ts, secret string) (string, error) {
	if secret == "" {
		secret = DataSecret
	}
	key := []byte(MD5Hex(ts + secret))
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	pad := aes.BlockSize - len(plain)%aes.BlockSize
	padded := make([]byte, len(plain)+pad)
	copy(padded, plain)
	for i := len(plain); i < len(padded); i++ {
		padded[i] = byte(pad)
	}
	out := make([]byte, len(padded))
	for i := 0; i < len(padded); i += aes.BlockSize {
		block.Encrypt(out[i:i+aes.BlockSize], padded[i:i+aes.BlockSize])
	}
	return base64.StdEncoding.EncodeToString(out), nil
}

// DecryptAESCBPRaw decrypts a raw AES-ECB ciphertext with PKCS7 padding removed.
func DecryptAESCBPRaw(raw, key []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 || len(raw)%aes.BlockSize != 0 {
		return nil, errors.New("jm: invalid ciphertext length")
	}
	out := make([]byte, len(raw))
	for i := 0; i < len(raw); i += aes.BlockSize {
		block.Decrypt(out[i:i+aes.BlockSize], raw[i:i+aes.BlockSize])
	}
	pad := int(out[len(out)-1])
	if pad <= 0 || pad > aes.BlockSize || pad > len(out) {
		return nil, errors.New("jm: bad padding")
	}
	for _, b := range out[len(out)-pad:] {
		if int(b) != pad {
			return nil, errors.New("jm: bad padding")
		}
	}
	return out[:len(out)-pad], nil
}
