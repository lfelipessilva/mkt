import React, { useState, useEffect } from "react";
import { ImageOff } from "lucide-react";
import { fetchMediaBlob } from "../api";
import { cn, Spinner } from "../ui";

export interface AuthImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  storagePath?: string;
  src?: string;
  alt?: string;
  fallbackText?: string;
}

export function AuthImage({
  storagePath,
  src,
  alt = "Imagem",
  className,
  style,
  fallbackText,
  ...rest
}: AuthImageProps): React.JSX.Element {
  const targetPath = storagePath || src || "";
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled = false;
    let createdUrl: string | null = null;

    if (!targetPath) {
      setLoading(false);
      setError(true);
      return;
    }

    setLoading(true);
    setError(false);

    if (targetPath.startsWith("data:") || targetPath.startsWith("blob:")) {
      setBlobUrl(targetPath);
      setLoading(false);
      return;
    }

    let cleanPath = targetPath;
    if (cleanPath.includes("/api/v1/media/file?path=")) {
      const parts = cleanPath.split("/api/v1/media/file?path=");
      cleanPath = decodeURIComponent(parts[1] || "");
    }

    fetchMediaBlob(cleanPath)
      .then((url) => {
        if (isCancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setBlobUrl(url);
        setLoading(false);
      })
      .catch(() => {
        if (!isCancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [targetPath]);

  if (loading) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center bg-slate-100 text-slate-400",
          className
        )}
        style={style}
      >
        <Spinner size="sm" />
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-1.5 bg-slate-100 px-3 py-4 text-center text-xs text-slate-400",
          className
        )}
        style={style}
      >
        <ImageOff className="h-5 w-5" />
        <span>{fallbackText || "Erro ao carregar"}</span>
      </div>
    );
  }

  return (
    <img
      src={blobUrl}
      alt={alt}
      className={cn("block", className)}
      style={style}
      {...rest}
    />
  );
}
