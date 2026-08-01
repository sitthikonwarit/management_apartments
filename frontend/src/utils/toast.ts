import Swal from "sweetalert2";

type ToastIcon = "success" | "error" | "warning" | "info";

const ToastMixin = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true,
  customClass: { popup: "app-toast" },
  didOpen: (toastEl) => {
    toastEl.addEventListener("mouseenter", Swal.stopTimer);
    toastEl.addEventListener("mouseleave", Swal.resumeTimer);

    let seconds = 0;
    const content = toastEl.querySelector(".swal2-html-container");
    const tick = () => {
      seconds++;
      if (content) content.innerHTML = `<small><i>${seconds} วินาทีที่แล้ว</i></small>`;
    };
    (toastEl as any)._timeInterval = setInterval(tick, 1000);
  },
  willClose: (toastEl) => {
    clearInterval((toastEl as any)._timeInterval);
  },
});

export function showToast(icon: ToastIcon, title: string) {
  ToastMixin.fire({
    icon,
    title,
    html: "<small><i>เมื่อสักครู่</i></small>",
  });
}

export const toastSuccess = (title: string) => showToast("success", title);
export const toastError = (title: string) => showToast("error", title);
export const toastWarning = (title: string) => showToast("warning", title);
export const toastInfo = (title: string) => showToast("info", title);
