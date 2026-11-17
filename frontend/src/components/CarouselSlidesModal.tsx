import React, { useState } from "react";
import type { CarouselRun, CarouselSlide } from "../types";
import { AuthImage } from "./AuthImage";
import { SlideLightboxModal, formatSlideBadgeLabel } from "./SlideLightboxModal";
import { ZoomIn } from "lucide-react";
import { orderSlides } from "../tabs/GalleryPage";
import { Badge, EmptyState, Modal } from "../ui";

export interface CarouselSlidesModalProps {
  isOpen: boolean;
  run: CarouselRun | null;
  onClose: () => void;
}

export function CarouselSlidesModal({
  isOpen,
  run,
  onClose,
}: CarouselSlidesModalProps): React.JSX.Element | null {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (!isOpen || !run) return null;

  const slides: CarouselSlide[] = orderSlides(run.slides || []);

  const handleOpenLightbox = (index: number) => {
    setLightboxIndex(index);
  };

  const handleCloseLightbox = () => {
    setLightboxIndex(null);
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="xl"
        title={`Todos os Slides (${slides.length})`}
        subtitle={`@${run.account_id} • ${run.tema || run.archetype_title}`}
        ariaLabel={`Slides do Carrossel @${run.account_id}`}
      >
        {slides.length === 0 ? (
          <EmptyState
            title="Nenhum slide disponível"
            description="Este carrossel ainda não possui slides renderizados."
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {slides.map((slide, idx) => (
              <button
                key={slide.id || slide.position}
                type="button"
                className="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                onClick={() => handleOpenLightbox(idx)}
                title="Clique para ampliar o slide"
              >
                <div className="relative aspect-[4/5] w-full overflow-hidden">
                  <AuthImage
                    storagePath={slide.storage_path}
                    alt={`Slide ${slide.position}`}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  />
                  <Badge
                    tone="neutral"
                    className="absolute left-2 top-2 border-white/20 bg-slate-900/80 text-[10px] text-white backdrop-blur"
                  >
                    {formatSlideBadgeLabel(slide.position)}
                  </Badge>
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <ZoomIn className="h-6 w-6 text-white" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Modal>

      <SlideLightboxModal
        isOpen={lightboxIndex !== null}
        slides={slides}
        initialIndex={lightboxIndex ?? 0}
        onClose={handleCloseLightbox}
        title={run.tema || run.archetype_title}
      />
    </>
  );
}
