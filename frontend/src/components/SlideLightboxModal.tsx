import React, { useEffect, useCallback } from "react";
import type { CarouselSlide } from "../types";
import { AuthImage } from "./AuthImage";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../ui";

export function formatSlideBadgeLabel(position: number): string {
  if (position === 1) {
    return "1 (Capa)";
  }
  return `Slide ${position}`;
}

export function resolveNextSlideIndex(currentIndex: number, totalSlides: number): number {
  if (totalSlides <= 0) return 0;
  return Math.min(currentIndex + 1, totalSlides - 1);
}

export function resolvePrevSlideIndex(currentIndex: number, totalSlides: number): number {
  if (totalSlides <= 0) return 0;
  return Math.max(currentIndex - 1, 0);
}

export function canNavigateNext(currentIndex: number, totalSlides: number): boolean {
  return currentIndex < totalSlides - 1;
}

export function canNavigatePrev(currentIndex: number): boolean {
  return currentIndex > 0;
}

export interface SlideLightboxModalProps {
  isOpen: boolean;
  slides: CarouselSlide[];
  initialIndex?: number;
  onClose: () => void;
  title?: string;
}

export function SlideLightboxModal({
  isOpen,
  slides,
  initialIndex = 0,
  onClose,
  title,
}: SlideLightboxModalProps): React.JSX.Element | null {
  const [activeIndex, setActiveIndex] = React.useState(initialIndex);

  useEffect(() => {
    setActiveIndex(initialIndex);
  }, [initialIndex, isOpen]);

  const total = slides.length;
  const currentSlide = slides[activeIndex];

  const handleNext = useCallback(() => {
    if (canNavigateNext(activeIndex, total)) {
      setActiveIndex((prev) => resolveNextSlideIndex(prev, total));
    }
  }, [activeIndex, total]);

  const handlePrev = useCallback(() => {
    if (canNavigatePrev(activeIndex)) {
      setActiveIndex((prev) => resolvePrevSlideIndex(prev, total));
    }
  }, [activeIndex, total]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight") {
        handleNext();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleNext, handlePrev, onClose]);

  if (!isOpen || !currentSlide) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Visualização de Slide em Alta Resolução"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-4xl flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-1">
          <div className="min-w-0 text-sm">
            <span className="font-semibold text-white">
              Slide {activeIndex + 1} de {total}
            </span>
            {title && (
              <span className="ml-1 truncate text-slate-300"> — {title}</span>
            )}
          </div>
          <button
            type="button"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            onClick={onClose}
            aria-label="Fechar preview"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center justify-center gap-3 sm:gap-5">
          <button
            type="button"
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-white/15 text-white transition-all hover:scale-105 hover:bg-white/30 disabled:pointer-events-none disabled:opacity-20"
            onClick={handlePrev}
            disabled={!canNavigatePrev(activeIndex)}
            aria-label="Slide anterior"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>

          <div className="max-h-[75vh] max-w-[680px] overflow-hidden rounded-xl bg-slate-900 shadow-2xl">
            <AuthImage
              storagePath={currentSlide.storage_path}
              alt={`Slide ${currentSlide.position}`}
              className={cn("block max-h-[75vh] w-full object-contain")}
            />
          </div>

          <button
            type="button"
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-white/15 text-white transition-all hover:scale-105 hover:bg-white/30 disabled:pointer-events-none disabled:opacity-20"
            onClick={handleNext}
            disabled={!canNavigateNext(activeIndex, total)}
            aria-label="Próximo slide"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  );
}
