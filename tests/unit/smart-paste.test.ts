import { describe, expect, it } from 'vitest'
import { parseSmartPaste, westernDigits } from '../../src/shared/smart-paste'

describe('Smart Paste', () => {
  it('reads a hosting provider e-mail', () => {
    const mail = [
      'Dear customer,',
      'Your VPS is ready.',
      'IP Address: 203.0.113.7',
      'SSH Port: 2222',
      'Username: root',
      'Password: Xy7#pq!9 z',
      'Control panel: https://panel.example.com:2083',
      'Support: support@host.example.com',
    ].join('\n')
    expect(parseSmartPaste(mail)).toEqual({
      address: '203.0.113.7',
      port: 2222,
      username: 'root',
      password: 'Xy7#pq!9 z',
    })
  })

  it('reads Persian labels and Persian digits', () => {
    const mail = [
      'سلام، سرور شما آماده است.',
      'آی‌پی سرور: ۱۸۵.۱۲.۷.۹',
      'پورت: ۲۲۰۲',
      'نام کاربری: root',
      'رمز عبور: Abc123$%',
    ].join('\n')
    expect(parseSmartPaste(mail)).toEqual({
      address: '185.12.7.9',
      port: 2202,
      username: 'root',
      password: 'Abc123$%',
    })
    expect(westernDigits('۰۱۲۳۴۵۶۷۸۹ ٠١٢')).toBe('0123456789 012')
  })

  it('reads an ssh command and an ssh:// link', () => {
    expect(parseSmartPaste('connect with ssh -p 2200 deploy@vps.example.net')).toEqual({
      address: 'vps.example.net',
      port: 2200,
      username: 'deploy',
    })
    expect(parseSmartPaste('ssh://admin@[2001:db8::5]:2022')).toEqual({
      address: '2001:db8::5',
      port: 2022,
      username: 'admin',
    })
  })

  it('reads user@ip, host:port values and = separators', () => {
    expect(parseSmartPaste('root@10.0.0.5 and pass: hunter2')).toEqual({
      address: '10.0.0.5',
      username: 'root',
      password: 'hunter2',
    })
    expect(parseSmartPaste('Server: vps1.example.com:2222\nLogin = ubuntu')).toEqual({
      address: 'vps1.example.com',
      port: 2222,
      username: 'ubuntu',
    })
  })

  it('does not take an e-mail address or a web link for the server', () => {
    expect(parseSmartPaste('Write to admin@example.com or open https://example.com')).toEqual({})
  })

  it('keeps the first value it finds for each field', () => {
    expect(parseSmartPaste('IP: 192.0.2.1\nBackup IP: 192.0.2.2')).toEqual({
      address: '192.0.2.1',
    })
  })
})
