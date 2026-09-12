"use client";
export function CloudStatus({
  loading,
  error,
  refresh,
  disabled = false,
}: {
  loading: boolean;
  error: string;
  refresh: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="cloud-status">
      <span role="status">
        {loading
          ? "正在读取云端数据……"
          : "重新打开页面或刷新可读取其他设备的最新保存。"}
      </span>
      <button
        className="secondary-button"
        disabled={loading || disabled}
        onClick={refresh}
      >
        刷新云端数据
      </button>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
