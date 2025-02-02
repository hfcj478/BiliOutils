import type { UserConfig, ConfigArray } from './types';
import { resolve } from 'path';
import { fork } from 'child_process';
import * as path from 'path';
import { getArg } from './utils/args';
import { getDelayTime, random, Sleep } from '@/utils/pure';
import { clearLogs } from '@/utils/log/file';
import { writeError } from './utils/log/std';
import { onExit } from './utils/node';

/**
 * 获取配置
 */
export async function config() {
  const { getConfigPathFile } = await import('./config/utils');
  const configPath = getArg('config')?.trim() as string;
  try {
    // 判断 configPath 是否有空格
    if (/\s/.test(configPath)) {
      writeError('配置路径不能包含空格');
      return;
    }
    const configs = getConfigPathFile(resolve(process.cwd(), configPath));
    if (!configs.length) {
      writeError('配置文件不存在');
      return;
    }
    const itemIndex = getArg('item');
    if (itemIndex) {
      return getConfigByItem(configs, itemIndex);
    }
    return configs;
  } catch (error) {
    writeError('配置路径可能存在问题\n');
    writeError(error.message);
  }
}

/**
 * 通过 item 列表获取配置
 */
export function getConfigByItem(configs: ConfigArray, item: string) {
  const len = configs.length;
  return item
    .split(',')
    .filter(Boolean)
    .map(item => {
      const config = configs.at(getItemIndex(item, len));
      if (config) return config;
      process.stdout.write(`配置item[${item}]为错误索引或该索引下的配置存在问题\n`);
    })
    .filter(Boolean);
}

export function runForkSync(
  config: UserConfig,
  index: number,
  forkPath = './bin/fork',
  tasks = '',
) {
  return new Promise((resolve, reject) => {
    const child = fork(path.resolve(__dirname, forkPath), [], {
      env: {
        ...process.env,
        __BT_CONFIG__: JSON.stringify(config),
        __BT_TASKS_STRING__: tasks,
        __BT_CONFIG_ITEM__: index.toString(),
      },
      detached: true,
    });

    // 退出时杀死子进程
    const clear = onExit(process, () => child.kill());

    child.once('exit', code => {
      clear();
      if (code === 0) {
        resolve(code);
        return;
      }
      reject(code);
    });
    child.on('message', msg => {
      if (msg === true) {
        clear();
        resolve(true);
      }
    });
    child.once('error', err => {
      clear();
      reject(err);
    });
  });
}

export async function runTask(configs?: ConfigArray, forkPath = './bin/fork', tasks = '') {
  if (!configs) {
    const { getConfig } = await import('./config/utils');
    configs = getConfig(true);
  }
  const length = configs.length;
  if (process.env.BILITOOLS_IS_ASYNC) {
    return await runTaskAsync(
      configs.filter(Boolean).map((config, index) => runForkSync(config!, index, forkPath, tasks)),
    );
  }
  for (let index = 0; index < length; index++) {
    const config = configs[index];
    process.stdout.write(`正在执行第${index + 1}/${length}个配置\n`);
    if (!config) {
      process.stdout.write(`该配置为无效配置，跳过执行\n\n`);
      continue;
    }
    try {
      await runForkSync(config, index, forkPath, tasks);
    } catch (error) {
      process.stdout.write(`${error.message || error}\n`);
    }
    process.stdout.write('执行完毕\n\n');
  }
  clearLogs();
}

function getItemIndex(item: string, len: number) {
  const itemNum = Number(item);
  // 超出范围的返回第一个
  if (itemNum > len || itemNum < -len) return 0;
  if (itemNum < 0) return itemNum;
  // 下标从 1 开始，所以 -1
  if (itemNum > 0) return itemNum - 1;
  return 0;
}

async function runTaskAsync(forkPromises: Promise<any>[]) {
  try {
    return await Promise.all(forkPromises);
  } catch (error) {
    process.stdout.write(`${error.message}`);
  }
  process.stdout.write('执行完毕\n\n');
}

/** 运行前休眠 */
export async function waitForArgs() {
  const delay = getArg('delay', false);
  if (delay) {
    const [delay1, delay2] = getDelayTime(delay);
    const delayTime = random(delay1, delay2);
    await printWaitTime(delayTime);
    await Sleep.wait(delayTime);
    return true;
  }
}

async function printWaitTime(delayTime: number) {
  const { defLogger } = await import('./utils/log/def');
  if (delayTime < 1000) {
    defLogger.info(`休眠 ${delayTime} 毫秒`);
    return;
  }
  const endTime = new Date(new Date().getTime() + delayTime),
    endTimeString = endTime.toLocaleTimeString('zh-CN');
  if (delayTime < 60000) {
    // 输出预计运行时间
    defLogger.info(`休眠大约 ${delayTime} 毫秒，预计运行时间 ${endTimeString}`);
    return;
  }
  defLogger.info(`休眠大约 ${delayTime} 毫秒，预计运行时间 ${endTimeString}`);
}
