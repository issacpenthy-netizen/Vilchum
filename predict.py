from ultralytics import YOLO

def main():
    model = YOLO("C:/Users/KIRY SOKHOUR/OneDrive/Desktop/image_recognition/runs/detect/bottle_can_v1/weights/best.pt")
    model.predict(
        source="C:/Users/KIRY SOKHOUR/OneDrive/Desktop/image_recognition/my_photos",
        save=True,
        conf=0.4,
        device=0,
        project="C:/yolo_runs",
        name="real_test",
    )

if __name__ == "__main__":
    main()