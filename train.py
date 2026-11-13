from ultralytics import YOLO

def main():
    model = YOLO("yolov8s.pt")
    model.train(
        data="C:/Users/KIRY SOKHOUR/Downloads/Bottle and Can Detection v2.v1i.yolov8/data.yaml",
        epochs=100,
        imgsz=640,
        batch=16,
        device=0,
        workers=4,
        patience=20,
        name="bottle_can_v1",
    )

if __name__ == "__main__":
    main()