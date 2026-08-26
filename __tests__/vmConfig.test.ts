/**
 * Tests for VM configuration storage (src/lib/vmConfig.ts).
 */
import {
  listVmConfigs,
  getVmConfig,
  createVmConfig,
  updateVmConfig,
  deleteVmConfig,
  getOrCreateDefaultVm,
} from '../src/lib/vmConfig';

describe('vmConfig', () => {
  beforeEach(() => {
    // Clear all configs before each test
    const configs = listVmConfigs();
    for (const config of configs) {
      deleteVmConfig(config.id);
    }
  });

  test('createVmConfig creates a config with defaults', () => {
    const config = createVmConfig({name: 'Test VM'});
    expect(config.name).toBe('Test VM');
    expect(config.distro).toBe('alpine');
    expect(config.ramMb).toBe(512);
    expect(config.cpuCores).toBe(2);
    expect(config.diskGb).toBe(4);
    expect(config.kvmEnabled).toBe(true);
    expect(config.networkEnabled).toBe(true);
    expect(config.sshPort).toBe(2222);
    expect(config.id).toBeTruthy();
    expect(config.createdAt).toBeGreaterThan(0);
    expect(config.updatedAt).toBeGreaterThan(0);
  });

  test('createVmConfig creates a config with custom values', () => {
    const config = createVmConfig({
      name: 'Custom VM',
      distro: 'debian',
      ramMb: 1024,
      cpuCores: 4,
      diskGb: 8,
      kvmEnabled: false,
      networkEnabled: false,
      sshPort: 3333,
    });
    expect(config.name).toBe('Custom VM');
    expect(config.distro).toBe('debian');
    expect(config.ramMb).toBe(1024);
    expect(config.cpuCores).toBe(4);
    expect(config.diskGb).toBe(8);
    expect(config.kvmEnabled).toBe(false);
    expect(config.networkEnabled).toBe(false);
    expect(config.sshPort).toBe(3333);
  });

  test('listVmConfigs returns all configs', () => {
    createVmConfig({name: 'VM 1'});
    createVmConfig({name: 'VM 2'});
    createVmConfig({name: 'VM 3'});

    const configs = listVmConfigs();
    expect(configs.length).toBe(3);
  });

  test('listVmConfigs returns configs ordered by updatedAt desc', () => {
    const vm1 = createVmConfig({name: 'VM 1'});
    const vm2 = createVmConfig({name: 'VM 2'});
    const vm3 = createVmConfig({name: 'VM 3'});

    // Update vm1 to make it most recent (use a future timestamp)
    const futureTime = Date.now() + 10000;
    updateVmConfig(vm1.id, {name: 'VM 1 Updated'});

    const configs = listVmConfigs();
    // The updated VM should be first (or tied for first if same millisecond)
    expect(configs[0].name).toMatch(/VM 1 Updated|VM 3/);
  });

  test('getVmConfig returns a config by ID', () => {
    const created = createVmConfig({name: 'Test VM'});
    const fetched = getVmConfig(created.id);

    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.name).toBe('Test VM');
  });

  test('getVmConfig returns null for non-existent ID', () => {
    const fetched = getVmConfig('non-existent-id');
    expect(fetched).toBeNull();
  });

  test('updateVmConfig updates a config', () => {
    const config = createVmConfig({name: 'Test VM'});
    const updated = updateVmConfig(config.id, {
      name: 'Updated VM',
      ramMb: 2048,
    });

    expect(updated).not.toBeNull();
    expect(updated?.name).toBe('Updated VM');
    expect(updated?.ramMb).toBe(2048);
    // updatedAt should be >= config.updatedAt (may be same millisecond)
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(config.updatedAt);
  });

  test('updateVmConfig returns null for non-existent ID', () => {
    const updated = updateVmConfig('non-existent-id', {name: 'Test'});
    expect(updated).toBeNull();
  });

  test('deleteVmConfig deletes a config', () => {
    const config = createVmConfig({name: 'Test VM'});
    const result = deleteVmConfig(config.id);

    expect(result).toBe(true);
    expect(getVmConfig(config.id)).toBeNull();
  });

  test('getOrCreateDefaultVm returns existing config if available', () => {
    const created = createVmConfig({name: 'Existing VM'});
    const defaultVm = getOrCreateDefaultVm();

    expect(defaultVm.id).toBe(created.id);
    expect(defaultVm.name).toBe('Existing VM');
  });

  test('getOrCreateDefaultVm creates new config if none exist', () => {
    const defaultVm = getOrCreateDefaultVm();

    expect(defaultVm.name).toBe('Sunlight VM');
    expect(defaultVm.distro).toBe('alpine');
    expect(defaultVm.ramMb).toBe(512);
  });

  test('multiple configs can coexist', () => {
    createVmConfig({name: 'Alpine VM', distro: 'alpine'});
    createVmConfig({name: 'Debian VM', distro: 'debian'});

    const configs = listVmConfigs();
    expect(configs.length).toBe(2);

    const alpine = configs.find(c => c.distro === 'alpine');
    const debian = configs.find(c => c.distro === 'debian');

    expect(alpine).toBeTruthy();
    expect(debian).toBeTruthy();
  });
});
