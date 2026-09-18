import { app } from 'electron'
import { join, dirname, resolve } from 'path'

/**
 * 在任何服务单例和 Electron 状态目录初始化前应用测试隔离目录。
 */
function applyUserDataOverride() {
    const overridePath = String(process.env.WEFLOW_USER_DATA_PATH || process.env.WEFLOW_CONFIG_CWD || '').trim()
    if (overridePath) {
        app.setPath('userData', resolve(overridePath))
    }
}

/**
 * 强制将本地资源目录添加到 PATH 最前端，确保优先加载本地 DLL
 * 解决系统中存在冲突版本的数据服务导致的应用崩溃问题
 */
function enforceLocalDllPriority() {
    const isDev = !!process.env.VITE_DEV_SERVER_URL
    const sep = process.platform === 'win32' ? ';' : ':'

    let possiblePaths: string[] = []

    if (isDev) {
        // 开发环境
        possiblePaths.push(join(process.cwd(), 'resources'))
    } else {
        // 生产环境
        possiblePaths.push(dirname(process.execPath))
        if (process.resourcesPath) {
            possiblePaths.push(process.resourcesPath)
        }
    }

    const dllPaths = possiblePaths.join(sep)

    if (process.env.PATH) {
        process.env.PATH = dllPaths + sep + process.env.PATH
    } else {
        process.env.PATH = dllPaths
    }

    
}

try {
    applyUserDataOverride()
    enforceLocalDllPriority()
} catch (e) {
    console.error('[WeFlow] Failed to enforce local service priority:', e)
}
