// Devices — List paired devices, revoke
import { WarshaClient, type DeviceId, type DeviceSummary } from '@warsha/client';
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Box, Text, Button, Card } from '@warsha/ui';
import React, { useState, useEffect } from 'react';

interface DevicesProps {
  client: WarshaClient;
  onBack: () => void;
}

export function Devices({ onBack }: DevicesProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPair, setShowPair] = useState(false);
  const [pairingCode, setPairingCode] = useState('');

  useEffect(() => {
    loadDevices();
  }, []);

  const loadDevices = async () => {
    try {
      // const data = await client.listDevices();
      // Mock data
      setDevices([
        { id: 'dev-1' as DeviceId, name: 'iPhone 15 Pro', pairedAt: new Date(Date.now() - 86400000).toISOString(), lastSeen: new Date().toISOString() },
        { id: 'dev-2' as DeviceId, name: 'iPad Pro', pairedAt: new Date(Date.now() - 172800000).toISOString(), lastSeen: new Date(Date.now() - 3600000).toISOString() },
      ]);
    } catch (error) {
      console.error('Failed to load devices:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (deviceId: string) => {
    if (!window.confirm(locale === 'ar' ? 'إلغاء إقران هذا الجهاز؟' : 'Revoke this device?')) return;
    try {
      // await client.revokeDevice(deviceId);
      setDevices(prev => prev.filter(d => d.id !== deviceId));
    } catch (error) {
      console.error('Failed to revoke device:', error);
    }
  };

  const handlePair = () => {
    // In real app: generate QR code with pairing data
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    setPairingCode(code);
    setShowPair(true);
  };

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleString(locale);
  };

  const getStatusColor = (lastSeen: string) => {
    const diff = Date.now() - new Date(lastSeen).getTime();
    return diff < 300000 ? '#10b981' : diff < 3600000 ? '#f59e0b' : '#9ca3af';
  };

  const getStatusLabel = (lastSeen: string) => {
    const diff = Date.now() - new Date(lastSeen).getTime();
    if (diff < 300000) return locale === 'ar' ? 'متصل' : 'Online';
    if (diff < 3600000) return locale === 'ar' ? 'نشط مؤخراً' : 'Recently active';
    return locale === 'ar' ? 'غير متصل' : 'Offline';
  };

  return (
    <Box dir={dir} className="devices" style={{ padding: '24px', minHeight: 'calc(100vh - 80px)', maxWidth: '800px' }}>
      <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <Box dir={dir}>
          <Button variant="ghost" size="sm" onClick={onBack} dir={dir} style={{ marginBottom: '8px' }}>
            ← {locale === 'ar' ? 'رجوع' : 'Back'}
          </Button>
          <Text size="xl" weight="bold" dir={dir}>
            {locale === 'ar' ? 'الأجهزة المقترنة' : 'Paired Devices'}
          </Text>
          <Text size="md" dir={dir} style={{ color: '#6b7280' }}>
            {locale === 'ar' ? 'إدارة الأجهزة المصرح لها بالوصول' : 'Manage authorized devices'}
          </Text>
        </Box>
        <Button variant="primary" onClick={handlePair} dir={dir}>
          + {locale === 'ar' ? 'إقران جهاز جديد' : 'Pair New Device'}
        </Button>
      </Box>

      {loading ? (
        <Box dir={dir} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
          <Text dir={dir}>{locale === 'ar' ? 'جاري التحميل...' : 'Loading...'}</Text>
        </Box>
      ) : (
        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {devices.length === 0 ? (
            <Card dir={dir} style={{ textAlign: 'center', padding: '48px 24px' }}>
              <Text size="md" dir={dir} style={{ color: '#9ca3af', marginBottom: '16px' }}>
                {locale === 'ar' ? 'لا توجد أجهزة مقترنة' : 'No paired devices'}
              </Text>
              <Text size="sm" dir={dir} style={{ color: '#9ca3af', marginBottom: '16px' }}>
                {locale === 'ar' ? 'استخدم التطبيق المحمول لمسح رمز QR وإقران جهاز' : 'Use the mobile app to scan QR code and pair a device'}
              </Text>
              <Button variant="primary" onClick={handlePair} dir={dir}>
                {locale === 'ar' ? 'إقران جهاز' : 'Pair Device'}
              </Button>
            </Card>
          ) : (
            devices.map(device => (
              <Card key={device.id} dir={dir} style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                backgroundColor: '#fafafa',
              }}>
                <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <Box style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    backgroundColor: '#dbeafe',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '24px',
                  }}>📱</Box>
                  <Box dir={dir}>
                    <Text weight="bold" dir={dir}>{device.name}</Text>
                    <Box dir={dir} style={{ display: 'flex', gap: '16px', marginTop: '4px', flexWrap: 'wrap' }}>
                      <Text size="xs" dir={dir} style={{ color: '#6b7280' }}>
                        {locale === 'ar' ? 'مقترن' : 'Paired'}: {formatTime(device.pairedAt)}
                      </Text>
                      <Text size="xs" dir={dir} style={{ color: '#6b7280' }}>
                        {locale === 'ar' ? 'آخر ظهور' : 'Last seen'}: {formatTime(device.lastSeen)}
                      </Text>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        backgroundColor: getStatusColor(device.lastSeen) + '20',
                        color: getStatusColor(device.lastSeen),
                        borderRadius: '9999px',
                        fontSize: '0.625rem',
                        fontWeight: 600,
                      }}>
                        <span style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: getStatusColor(device.lastSeen),
                        }} />
                        {getStatusLabel(device.lastSeen)}
                      </span>
                    </Box>
                  </Box>
                </Box>
                <Button variant="ghost" size="sm" onClick={() => handleRevoke(device.id)} dir={dir} style={{ color: '#ef4444' }}>
                  {locale === 'ar' ? 'إلغاء الإقران' : 'Revoke'}
                </Button>
              </Card>
            ))
          )}
        </Box>
      )}

      {showPair && (
        <div style={{
          position: 'fixed',
          top: 0,
          insetInlineStart: 0,
          insetInlineEnd: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          direction: dir,
        }}>
          <Card dir={dir} style={{ width: '100%', maxWidth: '400px', margin: '16px', textAlign: 'center' }}>
            <Text size="lg" weight="bold" dir={dir} style={{ marginBottom: '8px' }}>
              {locale === 'ar' ? 'إقران جهاز جديد' : 'Pair New Device'}
            </Text>
            <Text size="md" dir={dir} style={{ color: '#6b7280', marginBottom: '24px' }}>
              {locale === 'ar' 
                ? 'افتح تطبيق Warsha المحمول وامسح رمز QR أدناه'
                : 'Open the Warsha mobile app and scan the QR code below'}
            </Text>
            
            <Box dir={dir} style={{ 
              width: '200px', 
              height: '200px', 
              margin: '0 auto 24px',
              backgroundColor: '#f9fafb',
              border: '2px dashed #d1d5db',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Text size="xl" weight="bold" dir={dir} style={{ color: '#6b7280', marginBottom: '8px' }}>
                {t('devices.qr_code') || 'QR Code'}
              </Text>
              <Text size="xs" dir={dir} style={{ color: '#9ca3af' }}>
                {pairingCode}
              </Text>
            </Box>

            <Text size="sm" weight="medium" dir={dir} style={{ color: '#374151', marginBottom: '4px' }}>
              {locale === 'ar' ? 'رمز الإقران' : 'Pairing Code'}
            </Text>
            <Text size="lg" weight="bold" dir={dir} style={{ fontFamily: 'monospace', letterSpacing: '0.2em', marginBottom: '24px' }}>
              {pairingCode}
            </Text>

            <Box dir={dir} style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <Button variant="secondary" onClick={() => setShowPair(false)} dir={dir}>
                {locale === 'ar' ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button variant="primary" onClick={() => { 
                navigator.clipboard.writeText(pairingCode);
                setShowPair(false);
              }} dir={dir}>
                {locale === 'ar' ? 'نسخ الرمز' : 'Copy Code'}
              </Button>
            </Box>
          </Card>
        </div>
      )}
    </Box>
  );
}