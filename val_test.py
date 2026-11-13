from ultralytics import YOLO

def main():
    model = YOLO("runs/detect/bottle_can_v1/weights/best.pt")
    model.val(
        data="C:/Users/KIRY SOKHOUR/Downloads/Bottle and Can Detection v2.v1i.yolov8/data.yaml",
        split="test",
        device=0,
    )

if __name__ == "__main__":
    main()    