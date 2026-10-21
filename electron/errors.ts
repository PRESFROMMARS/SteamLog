/** Keep native/IPC diagnostics in logs; show actionable Chinese in the shop UI. */
export function readableError(error:unknown):string {
 const raw=error instanceof Error?error.message:String(error);
 const message=raw.replace(/^Error invoking remote method '[^']+':\s*/,'').replace(/^(?:Error|SqliteError):\s*/,'');
 if(/ENOSPC|SQLITE_FULL|disk.*full/i.test(message))return '磁盘空间不足，请清理空间后重试。';
 if(/EACCES|EPERM|readonly|read-only|permission denied/i.test(message))return '无法写入文件，请把程序放在可写文件夹，并检查文件或 U 盘权限。';
 if(/ENOENT|no such file|does not exist/i.test(message))return '找不到所需文件或文件夹，请确认文件仍在原处、U 盘已插好。';
 if(/SQLITE_BUSY|database is locked|EBUSY/i.test(message))return '账本或文件正在使用中，请关闭其他占用程序后重试。';
 if(/SQLITE_CORRUPT|SQLITE_NOTADB|malformed|not a database/i.test(message))return '账本文件无法读取，请使用已校验的备份恢复，并保留原文件。';
 if(/^[\u3400-\u9fff]/.test(message))return message;
 return '操作未完成，请重试；如仍失败，请联系家人检查本机日志。';
}
